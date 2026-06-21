import assert from "node:assert/strict";
import test from "node:test";
import { distill, PacketMeta } from "../compressor";
import { EvidenceBundle } from "../packages/shared";

const evidence = EvidenceBundle.parse({
  sessionId: "session-1",
  goal: "Make the migration idempotent",
  acceptanceCriteria: ["A repeated migration succeeds"],
  branch: "feature",
  gitStatus: " M migrate.ts",
  gitDiff: "+guardMigration();",
  changedFiles: ["migrate.ts"],
  commands: [
    {
      command: "npm test",
      exitCode: 1,
      output: "duplicate column: age",
    },
  ],
  latestFailure: "duplicate column: age",
  relevantTerminalExcerpt: "duplicate column: age",
});

const meta: PacketMeta = {
  sessionId: "session-1",
  sourceAgent: "claude",
  targetAgent: "codex",
  trigger: "crash",
  verificationCommand: "npm test",
  sourceTokens: 1000,
};

test("distill combines model claims with deterministic evidence and metadata", async () => {
  let receivedPrompt = "";
  let receivedOptions: { model: string; cwd: string } | undefined;

  const packet = await distill(evidence, meta, {
    backend: async (prompt, options) => {
      receivedPrompt = prompt;
      receivedOptions = options;
      return JSON.stringify({
        goal: "Make the migration idempotent",
        acceptanceCriteria: ["A repeated migration succeeds"],
        status: "tests_failing",
        summary: "The migration fails when the column already exists.",
        decisions: [
          { text: "Guard the schema change", source: "repository" },
        ],
        constraints: ["Do not drop existing data"],
        nextActions: ["Add a column-existence check"],
        diffSummary: ["Started the migration guard"],
        pitfalls: ["Do not execute ALTER TABLE unconditionally"],
        focusFiles: [
          {
            path: "migrate.ts",
            role: "migration entry point",
            state: "guard missing",
          },
        ],
        confidence: 2,
      });
    },
    model: "test-model",
    cwd: "/tmp/relay-test",
  });

  assert.match(receivedPrompt, /Make the migration idempotent/);
  assert.deepEqual(receivedOptions, {
    model: "test-model",
    cwd: "/tmp/relay-test",
  });
  assert.equal(packet.sessionId, meta.sessionId);
  assert.equal(packet.sourceAgent, meta.sourceAgent);
  assert.equal(packet.evidence.latestFailure, evidence.latestFailure);
  assert.deepEqual(packet.evidence.changedFiles, evidence.changedFiles);
  assert.equal(packet.metrics.confidence, 1);
});

test("distill returns a deterministic fallback when the backend fails", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const packet = await distill(evidence, meta, {
      backend: async () => {
        throw new Error("provider unavailable");
      },
    });

    assert.equal(packet.task.goal, evidence.goal);
    assert.equal(packet.state.status, "in_progress");
    assert.equal(packet.metrics.confidence, 0.3);
    assert.deepEqual(packet.evidence.diffSummary, ["migrate.ts changed"]);
    assert.match(packet.nextActions[1], /npm test/);
  } finally {
    console.warn = originalWarn;
  }
});
