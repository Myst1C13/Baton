import { EvidenceBundle } from "../packages/shared";

export interface BenchmarkCase {
  name: string;
  evidence: EvidenceBundle;
  verificationCommand: string;
  forceBackendFailure?: boolean;
}

const scenarios = [
  ["database-migration", "Make the user migration idempotent without losing existing data", "Running the migration twice succeeds", "src/migrations/add-user-role.ts", "npm test -- migration", "duplicate column: role"],
  ["websocket-reconnect", "Prevent duplicate events after a WebSocket reconnect", "Each event is delivered exactly once after reconnect", "src/live/socket.ts", "npm test -- websocket", "expected 1 event, received 2"],
  ["auth-boundary", "Reject cross-tenant invoice access at the API boundary", "A user cannot read another tenant's invoice", "src/routes/invoices.ts", "npm test -- authorization", "cross-tenant request returned 200"],
  ["cache-race", "Remove the cache stampede during concurrent cold starts", "Only one upstream request runs per cache key", "src/cache/loader.ts", "npm test -- cache-concurrency", "upstream called 24 times for one key"],
  ["worker-crash", "Resume queued work after a worker process crashes", "An acknowledged job is never processed twice", "src/queue/worker.ts", "npm test -- worker-recovery", "job 731 remained locked after SIGKILL"],
  ["provider-outage-fallback", "Preserve handoff evidence when the compression provider is unavailable", "A valid deterministic packet is emitted without a model response", "src/handoff/fallback.ts", "npm test -- fallback", "provider returned HTTP 503"],
] as const;

export const benchmarkCases: BenchmarkCase[] = scenarios.map(([name, goal, criterion, file, command, failure], index) => {
  const diagnosticBlock = [
    `scenario=${name}`,
    `attempt=${index + 1}`,
    `failure=${failure}`,
    "trace=controller -> adapter -> verifier -> handoff",
    "note=raw terminal history is intentionally verbose; the receiver can inspect the repository",
  ].join("\n");

  return {
    name,
    verificationCommand: command,
    forceBackendFailure: name === "provider-outage-fallback",
    evidence: EvidenceBundle.parse({
      sessionId: `benchmark-${index + 1}`,
      goal,
      acceptanceCriteria: [criterion],
      branch: `benchmark/${name}`,
      gitStatus: ` M ${file}`,
      gitDiff: `diff --git a/${file} b/${file}\n+// benchmark fixture change`,
      changedFiles: [file],
      commands: [{
        command,
        exitCode: 1,
        output: Array.from({ length: 24 }, () => diagnosticBlock).join("\n"),
      }],
      latestFailure: failure,
      relevantTerminalExcerpt: Array.from({ length: 12 }, () => diagnosticBlock).join("\n"),
    }),
  };
});
