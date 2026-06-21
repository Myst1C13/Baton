import assert from "node:assert/strict";
import test from "node:test";
import { RelayEvent } from "../packages/shared";
import { activeAgent, derivePhase, eventLine } from "../ui/src/live";

function event(type: string, payload: Record<string, unknown>) {
  return RelayEvent.parse({
    id: `event-${type}`,
    sessionId: "session-1",
    type,
    timestamp: "2026-06-21T00:00:00.000Z",
    payload,
  });
}

test("live UI renders the orchestrator's route-target payloads", () => {
  const switched = event("agent.switched", {
    from: { provider: "claude", model: "claude-opus" },
    to: { provider: "codex", model: "gpt-5-codex" },
  });

  assert.equal(
    eventLine(switched).value,
    "↪ relay: switched claude → codex"
  );
  assert.equal(activeAgent([switched]), "codex");
});

test("live UI reads nested handoff metrics and process argument arrays", () => {
  const handoff = event("handoff.created", {
    metrics: { reductionPercent: 93.4 },
  });
  const started = event("process.started", {
    command: "npm",
    args: ["test", "--", "migration"],
  });

  assert.equal(eventLine(handoff).value, "↪ relay: packet ready · −93%");
  assert.equal(eventLine(started).value, "$ npm test -- migration");
});

test("live UI treats a second started agent as a completed switch", () => {
  const claude = event("agent.started", {
    provider: "claude",
    model: "claude-sonnet",
  });
  const handoff = event("handoff.created", {
    metrics: { reductionPercent: 91 },
  });
  const codex = event("agent.started", {
    provider: "codex",
    model: "gpt-5-codex",
  });

  assert.equal(derivePhase([claude, handoff]), "switching");
  assert.equal(derivePhase([claude, handoff, codex]), "resumed");
  assert.equal(activeAgent([claude, handoff, codex]), "codex");
});
