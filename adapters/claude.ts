/**
 * RelayIDE — Claude provider adapter
 * ----------------------------------
 * Claude is ONE provider among many — not a home base. All Claude-specific
 * behavior lives here, behind the neutral `ProviderAdapter` interface.
 *
 *  - compress(): headless `claude -p` (the zero-cost distillation backend).
 *  - launch():   boots a FRESH session seeded with a handoff packet (resumption)
 *                and returns a ClaudeLiveSession that surfaces signals
 *                (onError → crash/rate_limit, usage → tokens).
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import {
  CompressBackend,
  LaunchOptions,
  LiveSession,
  ProviderAdapter,
  SessionUsage,
  ConversationSlice,
} from "../contracts";
import { HandoffPacket } from "../packages/shared";
import { buildContinuationPrompt } from "./continuation";

// ---------------------------------------------------------------------------
// compress — headless one-shot distillation backend (zero cost via subscription)
// ---------------------------------------------------------------------------

export const claudeCompress: CompressBackend = (prompt, opts) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", opts.model],
      { cwd: opts.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "ENOENT"
          ? new Error("`claude` CLI not found on PATH.")
          : err
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}.\nstderr:\n${stderr}`));
        return;
      }
      try {
        const env = JSON.parse(stdout);
        resolve(typeof env.result === "string" ? env.result : stdout);
      } catch {
        resolve(stdout);
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

// ---------------------------------------------------------------------------
// launch — resume a fresh session from a handoff packet
// ---------------------------------------------------------------------------

/**
 * A running (here: headless one-shot) Claude session. Surfaces the signals the
 * orchestrator monitors: `onError` (crash / rate_limit) and `usage` (tokens).
 * `result()` is a harness convenience to await the resumed agent's reply; in
 * production the output streams to the orchestrator as events instead.
 */
export class ClaudeLiveSession implements LiveSession {
  readonly provider = "claude";
  private errorCbs: Array<(e: unknown) => void> = [];
  private stdout = "";
  private stderr = "";
  private readonly _result: Promise<string>;

  constructor(public readonly model: string, private child: ChildProcess) {
    child.stdout?.on("data", (d) => (this.stdout += d.toString()));
    child.stderr?.on("data", (d) => (this.stderr += d.toString()));

    this._result = new Promise<string>((resolve, reject) => {
      child.on("error", (e) => {
        this.fireError({ kind: "crash", detail: String(e) });
        reject(e);
      });
      child.on("close", (code) => {
        const all = this.stdout + this.stderr;
        // Detection: a rate-limit message anywhere in the output → rate_limit.
        if (/\b429\b|rate[ _-]?limit/i.test(all)) {
          this.fireError({ kind: "rate_limit", detail: all.slice(0, 200) });
        }
        if (code !== 0) {
          this.fireError({ kind: "crash", detail: `exit ${code}` });
          reject(new Error(`claude exited ${code}: ${this.stderr}`));
          return;
        }
        try {
          const env = JSON.parse(this.stdout);
          resolve(typeof env.result === "string" ? env.result : this.stdout);
        } catch {
          resolve(this.stdout);
        }
      });
    });
  }

  private fireError(e: unknown) {
    for (const cb of this.errorCbs) cb(e);
  }

  usage(): SessionUsage {
    // Headless: no live meter — best-effort estimate from output seen so far.
    return { tokens: Math.ceil(this.stdout.length / 4), window: 200_000 };
  }
  onError(cb: (e: unknown) => void): void {
    this.errorCbs.push(cb);
  }
  readTranscript(): ConversationSlice {
    return { ask: "", tail: [] };
  }
  stop(): void {
    this.child.kill();
  }
  /** Harness-only: await the resumed agent's reply. */
  result(): Promise<string> {
    return this._result;
  }
}

export const claudeAdapter: ProviderAdapter = {
  provider: "claude",
  compress: claudeCompress,
  launch(opts: LaunchOptions): Promise<LiveSession> {
    if (!opts.manifestPath) {
      throw new Error("claudeAdapter.launch requires opts.manifestPath (the handoff packet to resume from).");
    }
    const packet = JSON.parse(
      fs.readFileSync(opts.manifestPath, "utf-8")
    ) as HandoffPacket;
    const prompt = buildContinuationPrompt(packet);

    const child = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", opts.model],
      { cwd: opts.workspace, env: process.env, stdio: ["pipe", "pipe", "pipe"] }
    );
    const session = new ClaudeLiveSession(opts.model, child);
    child.stdin.write(prompt);
    child.stdin.end();
    return Promise.resolve(session);
  },
};
