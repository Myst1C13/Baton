# RelayIDE Engine — Integration Contract

This is the contract for talking to the **engine** (Evidence Collector +
Distiller + Provider Adapters). The engine is a set of **pure functions the
orchestrator calls** — it never owns the loop, never touches Redis, never
touches the UI. This document specifies every input and output shape so other
scripts can integrate without reading the implementation.

All data shapes are **Zod schemas** in `packages/shared` — import the schema for
runtime validation (`.parse()`) and the inferred type for TypeScript. See
`packages/shared/README.md` for full field tables.

---

## The pipeline at a glance

```
RuntimeContext ─┐
                ├─► collectEvidence() ─► EvidenceBundle ─┐
git (pulled)  ──┘                                        ├─► distill() ─► HandoffPacket ─► adapter.launch() ─► LiveSession
                                          PacketMeta ─────┘
```

The orchestrator calls, in order: `collectEvidence` → `distill` →
`adapter.launch` (using `adapter.compress` as the distill backend under the
hood). Everything the engine produces is typed and Zod-validated.

---

## Public API

### 1. `collectEvidence(dir, runtime) → EvidenceBundle`

```ts
import { collectEvidence, RuntimeContext } from "./evidence-collector";

const evidence = collectEvidence(workspaceDir, runtimeContext);
```

- **`dir: string`** — absolute path to the workspace (a git repo).
- **`runtime: RuntimeContext`** — the ephemeral facts git can't provide (you supply these).
- **Returns `EvidenceBundle`** (validated). Throws only if the runtime context is malformed.

The collector pulls fresh git facts (branch, status, diff, changed files) and merges them with `runtime`.

### 2. `distill(evidence, meta) → Promise<HandoffPacket>`

```ts
import { distill, PacketMeta } from "./compressor";

const packet = await distill(evidence, meta);
```

- **`evidence: EvidenceBundle`** — from `collectEvidence`.
- **`meta: PacketMeta`** — the deterministic facts only you know (session, agents, trigger, live token count).
- **Returns `Promise<HandoffPacket>`** (validated). **Never throws** — on any failure (model down, bad JSON) it returns a deterministic fallback packet (`metrics.confidence = 0.3`).

For tests or embedded runtimes, an optional third argument can override the
compression backend, model, and working directory without changing global env:

```ts
await distill(evidence, meta, {
  backend: async () => JSON.stringify(claims),
  model: "test-model",
  cwd: workspaceDir,
});
```

### 3. `adapter.compress(prompt, opts) → Promise<string>`

The distillation backend. You normally don't call this directly — `distill` does. Selectable via env.

```ts
import { claudeAdapter } from "./adapters/claude";
const raw = await claudeAdapter.compress(prompt, { model, cwd });
```

### 4. `adapter.launch(opts) → Promise<LiveSession>`

Boots a fresh agent session seeded with a handoff packet (resumption).

```ts
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";

const ADAPTERS = { claude: claudeAdapter, codex: codexAdapter }; // the registry
const session = await ADAPTERS[target.provider].launch({
  model: target.model,
  workspace: dir,
  manifestPath: "/path/to/.relay_handoff.json",
});
```

- **`opts: LaunchOptions`** — `{ model, workspace, manifestPath }`. `manifestPath` is **required**.
- **Returns `Promise<LiveSession>`**.

### 5. `LiveSession` — the running agent (what the orchestrator monitors)

```ts
session.usage();        // → { tokens, window }     — for the context_full trigger
session.onError(cb);    // cb({ kind: "rate_limit" | "crash", detail })
session.readTranscript(); // → { ask, tail }        — for intent on the next handoff
session.stop();         // kill the process
// (concrete sessions also expose result(): Promise<string> for harness use)
```

---

## Input shapes (what YOU must provide)

### `RuntimeContext` → input to `collectEvidence`

The half of the evidence git can't give. In production the orchestrator fills it
from the live session; the ephemeral fields (`commands`, `latestFailure`,
`relevantTerminalExcerpt`) must be **recorded as the agent runs** — they can't be
recovered afterward.

```ts
interface RuntimeContext {
  sessionId: string;
  goal: string;                  // the original ask
  acceptanceCriteria: string[];
  commands: CommandResult[];     // { command, exitCode: number|null, output }[]
  latestFailure: string | null;  // most recent failing output (the crash/429)
  relevantTerminalExcerpt: string;
}
```

### `PacketMeta` → input to `distill`

The deterministic facts only the orchestrator knows. Notably `sourceTokens` must
be the **live session's token count** (the size being compressed) — the engine
uses it for the reduction metric.

```ts
interface PacketMeta {
  sessionId: string;
  sourceAgent: "claude" | "codex";   // who handed off
  targetAgent: "claude" | "codex";   // who picks up (from the router)
  trigger: "manual" | "rate_limit" | "crash" | "context_full";
  verificationCommand: string;       // e.g. "npm test"
  sourceTokens: number;              // live session token count
}
```

### `LaunchOptions` → input to `adapter.launch`

```ts
interface LaunchOptions {
  model: string;        // "" → provider's default (codex)
  workspace: string;    // absolute path
  manifestPath: string; // path to the .relay_handoff.json to resume from
}
```

### `CompressOptions` → input to `adapter.compress`

```ts
interface CompressOptions { model: string; cwd: string; }
```

---

## Output shapes (what the engine RETURNS)

### `EvidenceBundle` (collector output → distiller input)

```ts
{
  sessionId, goal, acceptanceCriteria,
  branch, gitStatus, gitDiff, changedFiles,   // git facts (collector pulls these)
  commands, latestFailure, relevantTerminalExcerpt
}
```

### `HandoffPacket` (distiller output → next agent + UI)

```ts
{
  version: "1.0", sessionId, sourceAgent, targetAgent, trigger,
  task: { goal, acceptanceCriteria },
  state: { status, summary },
  evidence: { changedFiles, commands, latestFailure, diffSummary },
  decisions, constraints, nextActions, verificationCommand,
  metrics: { sourceTokens, packetTokens, reductionPercent, confidence },
  pitfalls,    // "do NOT do X" — failure memory (defaults [])
  focusFiles   // { path, role, state }[] (defaults [])
}
```

Validate either side with the shared schema:

```ts
import { HandoffPacket } from "./packages/shared";
const result = HandoffPacket.safeParse(json);
if (!result.success) console.error(result.error.issues);
```

### `RelayEvent` (emitted to the timeline; stored by the event-store, not the engine)

```ts
{ id, sessionId, type, timestamp /*ISO*/, agent?, payload }
```

`type` is one of `RELAY_EVENT_TYPES` (`session.started`, `file.changed`,
`test.failed`, `limit.detected`, `handoff.created`, `agent.switched`, …).

---

## Configuration (environment variables)

The engine is configured by env vars (the orchestrator sets these, or overrides
`PacketMeta`/`LaunchOptions` directly):

| Var | Default | Purpose |
|---|---|---|
| `RELAY_COMPRESS_BACKEND` | `claude` | which provider distills (`claude` \| `codex`) |
| `RELAY_COMPRESSOR_MODEL` | `claude-sonnet-4-6` | the compression model |
| `RELAY_SESSION_ID` | `demo-session` | session id |
| `RELAY_SOURCE_AGENT` | `claude` | packet `sourceAgent` |
| `RELAY_TARGET_AGENT` | `codex` | packet `targetAgent` |
| `RELAY_TRIGGER` | `manual` | packet `trigger` |
| `RELAY_VERIFY_CMD` | `npm test` | `verificationCommand` |
| `RELAY_SOURCE_TOKENS` | (evidence approx) | live session token count for the metric |
| `RELAY_RESUME_PROVIDER` | `claude` | which provider resumes (`resume.ts` harness) |
| `RELAY_RESUME_MODEL` | per-provider default | resume model |

---

## Who owns what (boundary)

| Component | Owner | Imports the engine? |
|---|---|---|
| Evidence Collector, Distiller, Adapters | **engine (this repo)** | — |
| `packages/shared` schemas | **engine** (authored here) | everyone |
| Orchestrator (the loop, calls the engine) | teammate / shared | yes — calls `collectEvidence`/`distill`/`adapter.*` |
| Router (`route(reason) → {provider, model}`) | teammate | no — only returns a provider string the orchestrator resolves via the adapter registry |
| Event-store / Redis | teammate | no — receives emitted `RelayEvent`s |
| UI | teammate | no — reads packets/events from Redis |

**The engine never imports Redis, the orchestrator, the router, or the UI.** It
is called by them. The only thing the router shares with the engine is the
provider string (e.g. `"codex"`), which the orchestrator resolves to an adapter
via the registry: `ADAPTERS[router.route(reason).provider]`.

---

## Minimal end-to-end (how the orchestrator wires it)

```ts
import { collectEvidence } from "./evidence-collector";
import { distill } from "./compressor";
import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";

const ADAPTERS = { claude: claudeAdapter, codex: codexAdapter };

// on handoff trigger:
const evidence = collectEvidence(dir, runtimeContext);        // 1. gather
const target = router.route(reason, { current, snapshot });   // 2. router (teammate)
const packet = await distill(evidence, {                      // 3. distill
  sessionId, sourceAgent: current.provider, targetAgent: target.provider,
  trigger: reason.kind, verificationCommand, sourceTokens: liveTokenCount,
});
fs.writeFileSync(manifestPath, JSON.stringify(packet, null, 2)); // 4. persist
const session = await ADAPTERS[target.provider].launch({         // 5. resume
  model: target.model, workspace: dir, manifestPath,
});
session.onError((e) => { /* surface crash/rate_limit */ });
```
