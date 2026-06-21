/**
 * RelayIDE — Redis event-store demo
 * ---------------------------------
 * Wires the orchestrator to the Redis EventStore, runs a real switch (claude
 * rate-limits → codex), then SIMULATES A BROWSER REFRESH by rebuilding the
 * entire timeline + state + handoff purely from Redis. This is the
 * refresh-survival property the UI relies on (and the Redis-track demo).
 *
 * Prereq: a Redis server on :6379  (brew install redis && redis-server)
 * Run:    npx tsx redis-demo.ts
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveSession, ProviderAdapter } from "./contracts";
import { FleetRouter, Orchestrator } from "./orchestrator";
import { EventStore } from "./event-store";

const claims = JSON.stringify({
  goal: "Make applyMigration idempotent and safe to re-run.",
  acceptanceCriteria: ["Running applyMigration twice does not error"],
  status: "blocked",
  summary: "The age column may be half-applied after the crash.",
  decisions: [{ text: "Guard with a schema check before ALTER", source: "agent" }],
  constraints: ["migrations are append-only"],
  nextActions: ["Add a PRAGMA table_info(users) check before ALTER TABLE"],
  diffSummary: ["migrate.ts: added MigrationResult"],
  pitfalls: ["Do NOT re-run the migration blindly — the column may already exist"],
  focusFiles: [{ path: "migrate.ts", role: "the file to fix", state: "missing the guard" }],
  confidence: 0.9,
});

function fakeSession(provider: string, model: string): LiveSession {
  return {
    provider,
    model,
    usage: () => ({ tokens: 18420, window: 200_000 }),
    onError: () => {},
    readTranscript: () => ({ ask: "fix the migration", tail: [] }),
    stop: () => {},
  };
}

function fakeAdapter(provider: string): ProviderAdapter {
  return {
    provider,
    compress: async () => claims,
    launch: async (opts) => fakeSession(provider, opts.model),
  };
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "relay-redis-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });

  const sessionId = "redis-demo";
  const orchestrator = new Orchestrator({
    workspaceDir: dir,
    adapters: [fakeAdapter("claude"), fakeAdapter("codex")],
    router: new FleetRouter([
      { provider: "claude", model: "claude-opus-4-8" },
      { provider: "codex", model: "gpt-5-codex" },
    ]),
    goal: "Make applyMigration idempotent.",
    sessionId,
  });

  // ---- attach Redis ----
  const store = new EventStore({ sessionId });
  await store.clear();
  store.attach(orchestrator);

  // live log (what the WebSocket would push to the UI in real time)
  orchestrator.on("event", (e) => console.log(`[live]   ${e.id}  ${e.type}`));

  // run a switch: claude → codex on a rate_limit
  orchestrator.start({ provider: "claude", model: "claude-opus-4-8" }, fakeSession("claude", "claude-opus-4-8"));
  await orchestrator.requestSwitch({ kind: "rate_limit" });
  await new Promise((r) => setTimeout(r, 150)); // let fire-and-forget writes flush

  // ---- SIMULATE A BROWSER REFRESH: rebuild everything from Redis ----
  console.log("\n=== 🔄 SIMULATED REFRESH — engine forgotten, rebuilding from Redis ===");
  const timeline = await store.replay();
  console.log("timeline (replayed from the Redis stream):");
  for (const e of timeline) console.log(`   ${e.id}  ${e.type}`);
  console.log("\nsession state (hash):", await store.getState());
  const handoff = (await store.getHandoff()) as { goal?: string; metrics?: unknown } | null;
  console.log(
    "handoff (key):  goal =",
    JSON.stringify(handoff?.goal),
    "| metrics =",
    JSON.stringify(handoff?.metrics)
  );

  await store.close();
  orchestrator.stop();
  rmSync(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("[redis-demo] failed:", err);
  process.exit(1);
});
