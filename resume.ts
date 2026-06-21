/**
 * RelayIDE — Resume harness (Step 4 validation)
 * ---------------------------------------------
 * Closes the loop: reads `.relay_handoff.json`, boots a FRESH agent session
 * seeded with the packet (via the provider adapter), and prints how it resumes.
 * This is the test of the project's core premise — can a fresh agent pick up the
 * work from the packet alone, honoring the pitfalls and not redoing finished work?
 *
 * Run:  npx tsx resume.ts ./relay-mock
 *
 * Note: the packet's targetAgent may say "codex", but until the Codex adapter
 * exists (Step 5) we resume with Claude to validate resumption. The packet is
 * provider-neutral, so this proves the format works regardless of who reads it.
 */

import * as path from "path";
import { ProviderAdapter } from "./contracts";
import { claudeAdapter, ClaudeLiveSession } from "./adapters/claude";
import { codexAdapter, CodexLiveSession } from "./adapters/codex";

const WORKSPACE = path.resolve(process.argv[2] || "./relay-mock");
const MANIFEST = path.join(WORKSPACE, ".relay_handoff.json");

// Which provider resumes the work — proves any→any (claude↔codex).
const PROVIDER = process.env.RELAY_RESUME_PROVIDER || "claude";
const ADAPTERS: Record<string, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};
const adapter = ADAPTERS[PROVIDER] ?? claudeAdapter;
// Default model per provider ("" → codex uses its configured default).
const RESUME_MODEL =
  process.env.RELAY_RESUME_MODEL || (PROVIDER === "codex" ? "" : "claude-sonnet-4-6");

async function main(): Promise<void> {
  console.log(`[resume] workspace : ${WORKSPACE}`);
  console.log(
    `[resume] booting a fresh ${PROVIDER}${RESUME_MODEL ? ` (${RESUME_MODEL})` : ""} session from ${path.basename(MANIFEST)}…`
  );

  const session = (await adapter.launch({
    model: RESUME_MODEL,
    workspace: WORKSPACE,
    manifestPath: MANIFEST,
  })) as ClaudeLiveSession | CodexLiveSession;

  // Prove the signal plumbing is wired: log any crash / rate_limit the session surfaces.
  session.onError((e) => console.error("[resume] ⚠️  session signal:", JSON.stringify(e)));

  const output = await session.result();
  console.log("\n=========== FRESH AGENT'S RESUME PLAN ===========\n");
  console.log(output.trim());
  console.log("\n=================================================");
}

main().catch((err) => {
  console.error("\n[resume] ❌ resume failed:\n", err.message || err);
  process.exit(1);
});
