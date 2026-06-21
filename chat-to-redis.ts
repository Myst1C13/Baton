/**
 * RelayIDE — Compress a past Claude Code conversation → Redis
 * ----------------------------------------------------------
 * Reads a real session transcript (~/.claude/projects/<project>/<uuid>.jsonl),
 * extracts the intent thread, runs it through the real Distiller, and stores the
 * resulting HandoffPacket in Redis (stream + handoff key + state hash) — so you
 * can read it back exactly like the UI would.
 *
 * Run:   npx tsx chat-to-redis.ts            # uses the most recent transcript
 *        npx tsx chat-to-redis.ts <file.jsonl>
 *
 * Prereq: Redis on :6379.
 */

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import Redis from "ioredis";
import { collectEvidence } from "./evidence-collector";
import { distill, PacketMeta } from "./compressor";

const PROJECT_DIR = join(
  homedir(),
  ".claude/projects/-Users-cheng-Desktop-Projects-vscodebased-aihack"
);

/** Pick the transcript: argv path, else the most recent .jsonl. */
function transcriptPath(): string {
  if (process.argv[2]) return process.argv[2];
  const latest = execSync(`ls -t "${PROJECT_DIR}"/*.jsonl | head -1`, {
    encoding: "utf-8",
  }).trim();
  if (!latest) throw new Error(`No transcripts found in ${PROJECT_DIR}`);
  return latest;
}

/** Strip command/system noise so the model gets clean intent, not raw logs. */
function clean(text: string): string {
  return text
    .replace(/<local-command-[\s\S]*?<\/local-command-[^>]*>/g, "")
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, "")
    .replace(/<command-[^>]*>.*$/gm, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trim();
}

/** Extract the user's typed messages (the intent thread) from a JSONL transcript. */
function extractIntent(file: string, capChars = 12000): string {
  const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const asks: string[] = [];
  for (const line of lines) {
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === "user" && typeof row.message?.content === "string") {
      const c = clean(row.message.content);
      if (c) asks.push(c);
    }
  }
  return asks.join("\n\n---\n\n").slice(0, capChars);
}

async function main(): Promise<void> {
  const file = transcriptPath();
  const sessionId = `chat-${file.split("/").pop()!.replace(".jsonl", "").slice(0, 8)}`;
  console.log(`[chat] transcript : ${file}`);
  console.log(`[chat] sessionId  : ${sessionId}`);

  // 1. extract clean intent + a rough size of the whole session
  const intent = extractIntent(file);
  const sessionTokens = Math.ceil(readFileSync(file, "utf-8").length / 4);
  console.log(`[chat] intent     : ${intent.length} chars (session ≈ ${sessionTokens} tokens)`);

  // 2. build evidence (empty git workspace — a pure chat has no diff)
  const dir = mkdtempSync(join(tmpdir(), "relay-chat-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const evidence = collectEvidence(dir, {
    sessionId,
    goal: intent,
    acceptanceCriteria: [],
    commands: [],
    latestFailure: null,
    relevantTerminalExcerpt: "",
  });

  // 3. distill (real Claude backend)
  const meta: PacketMeta = {
    sessionId,
    sourceAgent: "claude",
    targetAgent: "codex",
    trigger: "manual",
    verificationCommand: "npm test",
    sourceTokens: sessionTokens,
  };
  console.log("[chat] distilling via Claude…");
  const packet = await distill(evidence, meta);

  // 4. store in Redis exactly like the event-store would
  const redis = new Redis("redis://127.0.0.1:6379", { maxRetriesPerRequest: 1 });
  const key = (s?: string) =>
    s ? `relay:session:${sessionId}:${s}` : `relay:session:${sessionId}`;
  const now = new Date().toISOString();
  await redis
    .pipeline()
    .del(key(), key("events"), key("handoff"))
    .set(key("handoff"), JSON.stringify(packet))
    .xadd(key("events"), "*", "data", JSON.stringify({
      id: `${sessionId}:1`,
      sessionId,
      type: "handoff.created",
      timestamp: now,
      agent: "claude",
      payload: { goal: packet.task.goal, metrics: packet.metrics },
    }))
    .hset(key(), { sessionId, lastEvent: "handoff.created", agent: "claude", updatedAt: now })
    .exec();
  await redis.quit();

  rmSync(dir, { recursive: true, force: true });

  console.log(
    `\n[chat] ✅ ${packet.metrics.sourceTokens} → ${packet.metrics.packetTokens} tokens ` +
      `(${packet.metrics.reductionPercent}% reduction, confidence ${packet.metrics.confidence})`
  );
  console.log(`[chat] goal: ${packet.task.goal.slice(0, 120)}…`);
  console.log(`[chat] stored in Redis under: relay:session:${sessionId}*`);
}

main().catch((err) => {
  console.error("[chat] failed:", err);
  process.exit(1);
});
