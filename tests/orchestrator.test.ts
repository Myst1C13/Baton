import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LiveSession,
  ProviderAdapter,
  RouteTarget,
} from "../contracts";
import {
  FleetRouter,
  Orchestrator,
  OrchestratorEvent,
} from "../orchestrator";
import { RelayEvent } from "../packages/shared";

class FakeSession implements LiveSession {
  private errorHandlers: Array<(error: unknown) => void> = [];
  stopped = false;

  constructor(
    readonly provider: string,
    readonly model: string,
    private readonly tokens = 500
  ) {}

  usage() {
    return { tokens: this.tokens, window: 200_000 };
  }

  onError(cb: (error: unknown) => void) {
    this.errorHandlers.push(cb);
  }

  readTranscript() {
    return { ask: "Build Relay", tail: [] };
  }

  stop() {
    this.stopped = true;
  }

  emitError(error: unknown) {
    for (const handler of this.errorHandlers) handler(error);
  }
}

const claims = JSON.stringify({
  goal: "Build Relay",
  acceptanceCriteria: ["The handoff succeeds"],
  status: "in_progress",
  summary: "Ready to resume on the next provider.",
  decisions: [],
  constraints: [],
  nextActions: ["Continue"],
  diffSummary: [],
  pitfalls: [],
  focusFiles: [],
  confidence: 0.9,
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-orchestrator-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function setup(
  dir: string,
  launchCodex: () => Promise<FakeSession>
): {
  orchestrator: Orchestrator;
  initial: FakeSession;
  events: OrchestratorEvent[];
  getLaunches: () => number;
} {
  let launches = 0;
  const claudeAdapter: ProviderAdapter = {
    provider: "claude",
    compress: async () => claims,
    launch: async () => new FakeSession("claude", "claude-model"),
  };
  const codexAdapter: ProviderAdapter = {
    provider: "codex",
    compress: async () => claims,
    launch: async () => {
      launches++;
      return launchCodex();
    },
  };
  const orchestrator = new Orchestrator({
    workspaceDir: dir,
    adapters: [claudeAdapter, codexAdapter],
    router: new FleetRouter([
      { provider: "claude", model: "claude-model" },
      { provider: "codex", model: "codex-model" },
    ]),
    goal: "Build Relay",
    sessionId: "session-test",
  });
  const events: OrchestratorEvent[] = [];
  orchestrator.on("event", (event) => events.push(event));
  const initial = new FakeSession("claude", "claude-model");
  orchestrator.start(
    { provider: "claude", model: "claude-model" },
    initial
  );
  return {
    orchestrator,
    initial,
    events,
    getLaunches: () => launches,
  };
}

test("orchestrator emits schema-valid events and ignores stale-session errors", async () => {
  const dir = workspace();
  try {
    const next = new FakeSession("codex", "codex-model");
    const { orchestrator, initial, events, getLaunches } = setup(
      dir,
      async () => next
    );

    await orchestrator.requestSwitch({ kind: "rate_limit" });

    assert.equal(orchestrator.getState().current?.provider, "codex");
    assert.equal(initial.stopped, true);
    assert.equal(getLaunches(), 1);
    for (const event of events) RelayEvent.parse(event);
    assert.deepEqual(
      events.slice(0, 3).map((event) => event.id),
      ["session-test:1", "session-test:2", "session-test:3"]
    );
    assert.ok(events.some((event) => event.type === "agent.switched"));

    initial.emitError({ kind: "crash", detail: "late old-session error" });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(getLaunches(), 1);
    assert.equal(orchestrator.getState().current?.provider, "codex");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stop during launch cancels the new session instead of resurrecting it", async () => {
  const dir = workspace();
  try {
    let resolveLaunch!: (session: FakeSession) => void;
    const launch = new Promise<FakeSession>((resolve) => {
      resolveLaunch = resolve;
    });
    const { orchestrator } = setup(dir, () => launch);

    const switching = orchestrator.requestSwitch({
      kind: "manual",
      target: { provider: "codex", model: "codex-model" } as RouteTarget,
    });
    await new Promise((resolve) => setImmediate(resolve));

    orchestrator.stop();
    const lateSession = new FakeSession("codex", "codex-model");
    resolveLaunch(lateSession);

    await assert.rejects(switching, /stopped while a switch was in flight/i);
    assert.equal(lateSession.stopped, true);
    assert.equal(orchestrator.getState().phase, "stopped");
    assert.equal(orchestrator.getState().current, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
