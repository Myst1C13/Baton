import assert from "node:assert/strict";
import test from "node:test";
import {
  createSession,
  switchAgent,
  type RelayApi,
} from "../ui/src/controlFlow";

class FakeApi implements RelayApi {
  readonly calls: Array<{ path: string; init?: RequestInit }> = [];

  constructor(private readonly responses: unknown[]) {}

  async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    this.calls.push({ path, init });
    return (this.responses.shift() ?? {}) as T;
  }
}

function body(call: { init?: RequestInit }): Record<string, unknown> {
  const raw = call.init?.body;
  if (typeof raw !== "string") throw new Error("expected string request body");
  return JSON.parse(raw) as Record<string, unknown>;
}

test("createSession uses the user-selected initial agent", async () => {
  const api = new FakeApi([{ id: "s1" }]);

  const id = await createSession(api, {
    goal: "Fix it",
    verificationCommand: "npm test",
    workspaceDir: "demo-repo",
    initialAgent: "codex",
  });

  assert.equal(id, "s1");
  assert.equal(api.calls[0]?.path, "/api/sessions");
  assert.deepEqual(body(api.calls[0]!), {
    goal: "Fix it",
    verificationCommand: "npm test",
    workspaceDir: "demo-repo",
    sourceAgent: "codex",
    targetAgent: "claude",
  });
});

test("switchAgent from a fresh session starts the selected initial agent before handoff", async () => {
  const api = new FakeApi([
    { id: "s1", state: "created" },
    {},
    { id: "s1", state: "codex_running" },
    {},
    {},
  ]);

  await switchAgent(api, {
    sessionId: "s1",
    initialAgent: "codex",
    target: "claude",
    models: { claude: "claude-sonnet", codex: "gpt-5-codex" },
    prompt: "continue",
  });

  assert.deepEqual(
    api.calls.map((call) => `${call.init?.method ?? "GET"} ${call.path}`),
    [
      "GET /api/sessions/s1",
      "POST /api/sessions/s1/codex/start",
      "GET /api/sessions/s1",
      "POST /api/sessions/s1/handoff",
      "POST /api/sessions/s1/claude/start",
    ]
  );
  assert.deepEqual(body(api.calls[1]!), {
    model: "gpt-5-codex",
    prompt: "continue",
  });
  assert.deepEqual(body(api.calls[4]!), {
    model: "claude-sonnet",
    prompt: "continue",
  });
});

test("switchAgent skips handoff creation when the packet is already ready", async () => {
  const api = new FakeApi([
    { id: "s1", state: "handoff_ready" },
    { id: "s1", state: "handoff_ready" },
    {},
  ]);

  await switchAgent(api, {
    sessionId: "s1",
    initialAgent: "claude",
    target: "codex",
    models: { claude: "claude-sonnet", codex: "gpt-5-codex" },
    prompt: "continue",
  });

  assert.deepEqual(
    api.calls.map((call) => `${call.init?.method ?? "GET"} ${call.path}`),
    [
      "GET /api/sessions/s1",
      "GET /api/sessions/s1",
      "POST /api/sessions/s1/codex/start",
    ]
  );
});
