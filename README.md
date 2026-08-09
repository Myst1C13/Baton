<p align="center">
  <img src="docs/baton-logo.png" alt="Baton" width="180">
</p>

<h1 align="center">Baton</h1>

<p align="center">
  <strong>Evidence-backed handoffs between AI coding agents.</strong>
</p>

<p align="center">
  <a href="https://github.com/Myst1C13/Baton/actions/workflows/ci.yml"><img src="https://github.com/Myst1C13/Baton/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%E2%89%A522-3c873a.svg" alt="Node 22 or newer"></a>
  <a href="tsconfig.json"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript strict mode"></a>
</p>

<p align="center"><em>Built at the UC Berkeley AI Hackathon, 2026.</em></p>

When an AI coding agent hits a usage limit, runs out of context, or crashes
mid-task, the next tool usually starts cold. Baton rebuilds the unfinished task
from evidence on disk — Git changes, command output, test results, and terminal
history — and compiles it into a compact, validated **handoff packet**. A
different agent resumes in the same repository, and Baton verifies the result
by running the project's real verification command.

Baton is not an editor or a Cursor clone. It transfers work *between* independent
tools (Claude Code ⇄ Codex CLI) through a visible, provider-neutral manifest.

![Baton demo — Claude reaches a limit, Baton hands off to Codex, and verification passes](docs/demo.gif)

*Claude Code hits a usage limit mid-fix → Baton compiles a verified handoff packet → Codex CLI resumes in the same repo → **Verify** runs the real tests and confirms the result.*

---

## Why Baton

Today, an AI coding agent is often a single point of failure. When a session
stops, the developer becomes the recovery mechanism: re-reading the diff,
reconstructing what the agent attempted, and prompting a fresh tool from
scratch. That recovery cost grows with the size of the change.

Baton removes the human from the recovery loop. It treats agent work as
**portable state**, not a disposable chat session. The state is rebuilt from
evidence the machine can verify — `git diff`, test exit codes, terminal output —
rather than from an agent's self-report, which may be wrong or optimistic. That
validated packet can be handed to another compatible tool, so work can survive
the session that started it.

## What works today

- Start Claude Code or Codex CLI against a local repository.
- Stream normalized process, terminal, file, and test events into the dashboard.
- Trigger a handoff manually or after a detected rate limit/context threshold.
- Rebuild state from Git, terminal evidence, and command exit codes.
- Distill that evidence into a small, runtime-validated handoff packet.
- Resume the other provider with the packet and repository already on disk.
- Run a user-selected verification command and decide pass/fail from its exit code.
- Persist event timelines and the latest packet in Redis when configured, with an
  in-memory implementation for local demos and tests.

The bundled demo uses deterministic fake agents so the complete flow is
repeatable without provider accounts. Real mode uses locally installed and
authenticated `claude` and `codex` CLIs.

## Trust boundary

Baton's server binds to `127.0.0.1`, keeps provider credentials in memory, and
does not require a hosted Baton service. Real agent runs still send prompts and
repository context to the provider selected by the user. The current Distiller
can include Git diffs and failure output in that provider request, so Baton
should not be described as keeping all code on-device.

Secret redaction, repository policies, signed audit logs, and self-hosted team
controls are roadmap work, not current guarantees.

## Current limitations

- Only Claude Code and Codex CLI have first-party adapters.
- Rate-limit and context-pressure detection exist; general provider-health and
  arbitrary-stall detection do not.
- Automatic handoffs are intentionally bounded to avoid provider ping-pong.
- Verification is one command and one exit-code verdict.
- Redis preserves events and packets, not the complete live process/session state.

---

## Quickstart

### Requirements

- Node.js 22 or newer
- npm
- Git

No provider account or Redis installation is required for the deterministic
demo.

```bash
git clone https://github.com/Myst1C13/Baton.git
cd Baton
npm ci
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

## Screens

| Ready | Handoff | Verified |
| --- | --- | --- |
| ![Baton ready](docs/devpost-1-ready.png) | ![Baton handoff](docs/devpost-2-handoff.png) | ![Baton verified](docs/devpost-3-verified.png) |

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

### Distiller pipeline

```text
repository + runtime
        │
        ▼
Evidence Collector ──► EvidenceBundle (Zod)
        │                     │
        │                     ├─ goal + acceptance criteria
        │                     ├─ git branch/status/diff
        │                     ├─ changed files + commands
        │                     └─ latest failure + terminal excerpt
        ▼
Prompt Assembler ──► Claude or Codex compression backend
                              │
                              ▼
                    DistilledClaims (Zod)
                              │
EvidenceBundle + session metadata
                └─────────────┤
                              ▼
                    deterministic packet builder
                              │
                              ▼
                     HandoffPacket (Zod)
                              │
                 Redis/in-memory store ──► next agent
```

The model supplies only reasoning that cannot be recovered directly from disk:
the current summary, decisions, constraints, next actions, pitfalls, and focus
files. Baton fills changed files, command exit codes, provider identities, and
the verification command from deterministic evidence. If model distillation
fails or returns invalid JSON, Baton emits a deterministic fallback packet
instead of abandoning the transfer.

### What is in a handoff packet?

Each packet is a versioned, Zod-validated contract containing:

- the original goal and acceptance criteria;
- source and target agents plus the handoff trigger;
- current status, decisions, constraints, and next actions;
- changed files, failed commands, exit codes, and a bounded failure summary;
- focus files and pitfalls that help the next agent avoid repeating mistakes;
- the verification command and context-reduction telemetry.

The latest packet and its event timeline are stored in Redis when `REDIS_URL`
is configured. Otherwise Baton uses the same storage interface in memory. Redis
persists the handoff; the packet itself remains provider-neutral.

### Context-reduction metric

Baton compares the source-session context with the serialized handoff packet and
reports the estimated reduction. The current implementation uses observed token
usage when an adapter exposes it and a documented four-characters-per-token
estimate for serialized packet content. This is directional telemetry, not yet
a claim about total model cost or a benchmark across real-world sessions.

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

## Reproducible benchmark

`npm run benchmark` runs six deterministic coding-failure fixtures through the
same distiller used by Baton. It verifies schema validity and retention of the
goal, acceptance criteria, changed files, command exit codes, latest failure,
and verification command. One case deliberately takes the compression backend
offline to exercise the deterministic fallback. The command writes both JSON
and Markdown reports to `benchmarks/results/`.

The report compares serialized evidence with the handoff payload using Baton's
documented four-characters-per-token estimate. It intentionally does **not**
claim model quality, provider cost, or end-to-end coding success.

Redis is optional — set `REDIS_URL` for durable, refresh-surviving timelines;
without it, an in-memory store with the same interface is used.

## Built with

TypeScript · Node.js · React · Vite · Redis · WebSocket · Zod · Claude · Codex

## Roadmap

- Add an opt-in authenticated Claude Code/Codex end-to-end benchmark alongside
  the deterministic regression benchmark.
- Restore resumable process state across Baton server restarts.
- Add controlled multi-hop handoffs with verification at every transfer.
- Support more coding agents through the existing adapter contract.
- Add richer verdicts such as per-test results, coverage deltas, and lint gates.
- Add secret redaction and repository-level provider policies.

---

## Credits

Built at the UC Berkeley AI Hackathon, 2026, by:

- **Syed Mohammad Husain** ([@Myst1C13](https://github.com/Myst1C13))
- **Michael Lai** ([@Unieggy](https://github.com/Unieggy))
- **James Bodebiyi** ([@jduhking](https://github.com/jduhking))

## License

[MIT](LICENSE) © 2026 Syed Mohammad Husain and Baton contributors.
