/**
 * RelayIDE — LiveSession signal-detection test
 * --------------------------------------------
 * Verifies that ClaudeLiveSession actually surfaces the signals the orchestrator
 * relies on — `rate_limit` and `crash` — WITHOUT needing a real 429 or the real
 * `claude` binary. We wrap a FAKE agent process (a `node -e` script that prints
 * a rate-limit line / exits non-zero / exits cleanly) and assert `onError` fires
 * with the right kind.
 *
 * Run:  npx tsx test-detection.ts
 */

import { spawn } from "child_process";
import { ClaudeLiveSession } from "./adapters/claude";

/** Spawn a fake agent that runs the given JS body and then exits. */
function fakeAgent(body: string) {
  return spawn(process.execPath, ["-e", body], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

interface Signal {
  kind?: string;
}

async function runScenario(
  name: string,
  body: string
): Promise<{ kinds: string[]; resolved: boolean; value?: string }> {
  const child = fakeAgent(body);
  const session = new ClaudeLiveSession("fake-model", child);
  const kinds: string[] = [];
  session.onError((e) => kinds.push((e as Signal)?.kind ?? "unknown"));
  child.stdin.end();
  try {
    const value = await session.result();
    return { kinds, resolved: true, value };
  } catch {
    return { kinds, resolved: false };
  }
}

function check(label: string, pass: boolean) {
  console.log(`  ${pass ? "✅" : "❌"} ${label}`);
  return pass;
}

async function main(): Promise<void> {
  let allPass = true;

  // --- Scenario 1: rate limit + non-zero exit ----------------------------
  console.log("Scenario 1 — agent prints a 429 and crashes:");
  const s1 = await runScenario(
    "rate_limit",
    `console.log("Error: 429 rate limit exceeded on retry"); process.exit(1);`
  );
  allPass = check("fires rate_limit", s1.kinds.includes("rate_limit")) && allPass;
  allPass = check("fires crash", s1.kinds.includes("crash")) && allPass;
  allPass = check("result() rejects", s1.resolved === false) && allPass;

  // --- Scenario 2: clean success -----------------------------------------
  console.log("Scenario 2 — agent exits cleanly with a result:");
  const s2 = await runScenario(
    "clean",
    `console.log(JSON.stringify({ result: "done" })); process.exit(0);`
  );
  allPass = check("no error signals", s2.kinds.length === 0) && allPass;
  allPass = check("result() resolves", s2.resolved === true) && allPass;
  allPass = check('result is "done"', s2.value === "done") && allPass;

  // --- Scenario 3: crash WITHOUT a rate limit ----------------------------
  console.log("Scenario 3 — agent crashes with no rate-limit message:");
  const s3 = await runScenario(
    "crash",
    `console.error("Fatal: segmentation fault"); process.exit(139);`
  );
  allPass = check("fires crash", s3.kinds.includes("crash")) && allPass;
  allPass =
    check("does NOT fire rate_limit", !s3.kinds.includes("rate_limit")) &&
    allPass;
  allPass = check("result() rejects", s3.resolved === false) && allPass;

  console.log(
    `\n${allPass ? "✅ ALL DETECTION TESTS PASSED" : "❌ SOME TESTS FAILED"}`
  );
  process.exit(allPass ? 0 : 1);
}

main();
