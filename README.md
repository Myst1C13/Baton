# Baton

![Baton logo](docs/baton-logo.png)

**Baton compiles noisy agent work into the smallest verified state another coding tool needs to continue.**

When an AI coding agent hits a usage limit, crashes, or stalls mid-task, you
normally have to re-explain everything to the next tool. Baton captures the
unfinished work from *factual evidence* (git diff, test exit codes, terminal
output), compiles a small portable **handoff packet**, launches a **different**
agent in the same repository, and verifies whether it actually finished — the
developer never re-explains the task.

Baton is not an editor or a Cursor clone. It transfers work *between* independent
tools (Claude Code ⇄ Codex CLI) through a visible, provider-neutral manifest.

---

## Why Baton

Today, an AI coding agent is a single point of failure. The moment it stops —
usage limit, crash, network blip, or a provider-side outage — the context dies
with the session. The developer becomes the recovery mechanism: re-reading the
diff, reconstructing what the agent was attempting, and re-prompting a fresh tool
from scratch. That re-explanation tax is paid every time, and it grows with the
size of the change.

Baton removes the human from the recovery loop. It treats agent work as
**portable state**, not a disposable chat session. The state is rebuilt from
evidence the machine can verify — `git diff`, test exit codes, terminal output —
rather than from an agent's self-report, which may be wrong or optimistic. That
verified packet is small enough to hand to *any* compatible tool, so work
survives the death of the agent that started it.

### For individual developers

- **Never re-explain a task.** When your agent quits mid-change, Baton hands the
  next tool a packet that already encodes intent, current diff, and the failing
  check. You approve; you don't re-narrate.
- **Provider-neutral.** Not locked to one vendor. When Claude Code stalls, Codex
  CLI continues — and vice versa. Use whichever tool is available, healthy, or
  cheaper right now.
- **Evidence over vibes.** A handoff isn't "the agent said it's done." Baton runs
  the real verification command and shows the exit code and verdict. Truth comes
  from the repo, not the transcript.
- **Local and private by default.** The control server binds to loopback only;
  your code and secrets stay on your machine.

### For teams and enterprises

- **Resilience to provider outages and rate limits.** A single vendor's
  degradation no longer halts engineering work. Baton fails over to a second
  agent automatically, so an upstream incident becomes a slowdown instead of a
  stop. (See [Surviving a server outage](#surviving-a-server-outage).)
- **Auditable handoffs.** Every transfer is a visible, provider-neutral manifest
  plus a verification verdict — an artifact you can log, review, and attach to a
  change. No black-box "the AI did something."
- **Vendor independence / no lock-in.** Contracts live in `packages/shared` and
  are provider-agnostic. Procurement and platform teams keep leverage; adding or
  swapping a CLI is an adapter, not a rewrite.
- **Cost control.** Route work to the cheapest healthy provider, and stop paying
  the hidden labor cost of engineers manually rebuilding lost context.
- **Compliance-friendly evidence trail.** Because state is reconstructed from git
  and command exit codes, each handoff carries a factual, reproducible record of
  what changed and whether it passed.

### Surviving a server outage

Provider outages and regional API degradation are now a routine operational risk.
When the agent you're using goes down mid-task, the normal failure mode is total:
the session is gone, the in-flight reasoning is gone, and a human has to restart
the work elsewhere from memory.

Baton turns that hard failure into a soft one:

1. The active agent stalls or errors (limit hit, 5xx, timeout, provider outage).
2. Baton freezes the workspace and compiles the verified handoff packet from the
   repo state that already exists on disk — no dependency on the down provider.
3. It launches a **different** agent, on a **different** provider, in the same
   repo, seeded only by that packet.
4. The new agent continues; **Verify** confirms the result against real tests.

The packet is built from local, durable evidence, so it does not need the failed
service to be reachable. With `REDIS_URL` set, in-flight timelines also survive a
restart of Baton itself — so a crash of the orchestrator, not just the agent, is
recoverable. The practical effect: **one provider's bad day stops being your
team's blocked day.**

---

## Quickstart

```bash
npm install
npm run demo
```

Open the printed dashboard URL (`http://127.0.0.1:4173/?api=…&ws=…`) and click
**Start Baton**. The demo runs deterministic fake agents end-to-end — no provider
CLI or auth required. Fake Claude reports a delayed usage limit, Baton
automatically hands the task to fake Codex, and **Verify** runs the real fixture
tests.

If those ports are already occupied, choose explicit alternatives:

```bash
PORT=4001 WEB_PORT=4174 npm run demo
```

Run the desktop app against the real subscription-authenticated CLIs:

```bash
claude                # complete Claude sign-in once, then exit
codex login           # complete Codex/ChatGPT sign-in once
npm run desktop:real  # leave API-key fields blank
```

### Docked sidebar (terminal companion)

Pin the rail beside your real terminal as a frameless desktop window:

```bash
npm run demo       # in one shell (server + UI)
npm run sidebar    # in another — opens the rail-only companion
```

Or open the rail-only view in any browser: `http://127.0.0.1:4173/?rail=1`.

### Desktop companion (Electron)

A native window that snaps to a screen edge — the "magnet" companion — and
adds a native folder picker for the workspace:

```bash
npm run desktop              # one-command safe demo; docks right
npm run desktop:real         # real locally authenticated CLIs
RELAY_DOCK=left  npm run desktop
RELAY_DOCK=float npm run desktop
RELAY_ONTOP=1    npm run desktop  # optional floating/always-on-top mode
```

The command starts the server, UI, and Electron shell together; closing Electron
stops the local stack. Inside the desktop app the Workspace field gains a
**Browse…** button (native OS folder dialog).

## The demo flow

1. An agent (Claude) starts fixing a real bug in `demo-repo/` — the `users.age`
   migration runs `ALTER TABLE` unconditionally, so the focused test fails.
2. The agent hits a usage limit with the test still red.
3. Baton freezes the workspace, distills a validated handoff packet, and launches
   the other agent (Codex) in the same repo from that packet alone.
4. Codex finishes the task; click **Verify** and Baton runs the real verification
   command, showing the exit code and verdict.

The user never re-explains the task during the transfer.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  React / Vite dashboard (ui/)                                │
│  live terminal + Baton rail   ◀── WebSocket events           │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTP (/api) + WS (/ws/sessions/:id)
┌───────────────▼─────────────────────────────────────────────┐
│  Node + TypeScript server (apps/server/src/)                 │
│  ┌────────────┐ ┌───────────┐ ┌────────────┐ ┌────────────┐ │
│  │ session    │ │ process   │ │ orchestr.  │ │ broadcaster│ │
│  │ manager    │ │ runner    │ │ + handoff  │ │ (WS)       │ │
│  └────────────┘ └───────────┘ └─────┬──────┘ └────────────┘ │
│  ┌────────────┐ ┌───────────┐       │  ┌──────────────────┐ │
│  │ adapters   │ │ verifier  │       └─▶│ event store      │ │
│  │ claude/cdx │ │           │          │ Redis | in-memory│ │
│  └─────┬──────┘ └───────────┘          └──────────────────┘ │
└────────┼─────────────────────────────────────────────────────┘
         ▼
   Local Git repository (the workspace the agents operate in)
```

The browser requests actions; the server controls processes and secrets.
Evidence flows from the repo and command exit codes — **the repository and
executable evidence outrank agent summaries.**

The local control server binds to loopback only (`127.0.0.1`) and accepts
browser/WebSocket traffic from the configured dashboard origin.

## Repository map

```text
packages/shared/    Runtime-validated contracts (RelayEvent, HandoffPacket, …)
apps/server/src/    HTTP, sessions, WebSockets, process runner, adapters, store
ui/src/             Terminal companion dashboard + live event projection
demo-repo/          Deterministic migration bug — the handoff target
tests/              Engine + cross-layer contract tests
```

Shared schemas are the dependency boundary: every layer may import
`packages/shared`, but contracts never import an application. Adapters emit
`RelayEvent`s through a `RelayEventSink`; they don't know whether events are
broadcast, persisted, or both.

## Verification

```bash
npm test          # engine + server suites
npm run typecheck
npm run ui:build
```

Redis is optional — set `REDIS_URL` for durable, refresh-surviving timelines;
without it, an in-memory store with the same interface is used.

## Built with

TypeScript · Node.js · React · Vite · Redis · WebSocket · Zod · Claude · Codex

## Roadmap

**Near term**

- Real multi-CLI runs with authenticated `claude` + `codex`
- Session persistence across server restarts
- BatonBench baseline runs (the Baton side is measured; no-Baton is still empty)
- Controlled multi-hop handoffs (A → B → C, each transfer verified)
- Signed desktop packaging and a user-configurable dock layout

**Provider resilience**

- Health-aware routing: detect rate limits / outages and fail over before a task
  stalls, not after.
- Pluggable adapters for more agents (additional CLIs and IDE agents) behind the
  same provider-neutral contract.
- Automatic retry-and-escalate: try a cheaper model, fall back to a stronger one
  only when verification fails.

**Team & enterprise**

- Shared handoff packets so a transfer can move *between developers*, not just
  between tools — pick up a teammate's in-flight agent work.
- Centralized, signed audit log of every handoff and verification verdict for
  compliance and review.
- Policy controls: allowed providers, data-residency boundaries, and per-repo
  verification commands enforced by the orchestrator.
- Self-hosted / VPC deployment with SSO, so the control plane stays inside the
  enterprise perimeter.

**Verification**

- Richer verdicts beyond a single exit code (per-test results, coverage deltas,
  lint/type gates) attached to each packet.
