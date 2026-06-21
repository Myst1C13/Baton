/**
 * RelayIDE — Codex provider adapter
 * ---------------------------------
 * Codex as a peer of Claude — same `ProviderAdapter` interface. Uses the local
 * `codex exec` headless mode (zero cost via the user's ChatGPT sign-in, no API
 * key) and parses its `--json` JSONL event stream.
 *
 *  - compress(): `codex exec --json` → the agent_message text (distillation).
 *  - launch():   resume a fresh Codex session from a handoff packet.
 *
 * JSONL events: `item.completed` (item.type "agent_message") carries the reply
 * text; `turn.completed.usage` carries token counts.
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

interface CodexUsage {
  input_tokens: number;
  output_tokens: number;
}

/** Pull the agent's reply text + usage out of codex's --json JSONL output. */
function parseCodexJsonl(raw: string): { text: string; usage?: CodexUsage } {
  let text = "";
  let usage: CodexUsage | undefined;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let ev: any;
    try {
      ev = JSON.parse(t);
    } catch {
      continue;
    }
    if (
      ev.type === "item.completed" &&
      ev.item?.type === "agent_message" &&
      typeof ev.item.text === "string"
    ) {
      text += (text ? "\n" : "") + ev.item.text;
    } else if (ev.type === "turn.completed" && ev.usage) {
      usage = ev.usage;
    }
  }
  return { text, usage };
}

/** Only pass -m when the model id is actually a Codex/OpenAI model. */
function codexModelArg(model: string): string[] {
  return /^(gpt|o\d|codex)/i.test(model) ? ["-m", model] : [];
}

function codexArgs(model: string, cwd: string, prompt: string): string[] {
  return [
    "exec",
    "--skip-git-repo-check",
    "--json",
    ...codexModelArg(model),
    "-C",
    cwd,
    prompt,
  ];
}

// ---------------------------------------------------------------------------
// compress
// ---------------------------------------------------------------------------

export const codexCompress: CompressBackend = (prompt, opts) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn("codex", codexArgs(opts.model, opts.cwd, prompt), {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "ENOENT" ? new Error("`codex` CLI not found on PATH.") : err
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`codex exited with code ${code}.\nstderr:\n${stderr}`));
        return;
      }
      const { text } = parseCodexJsonl(stdout);
      if (!text) {
        reject(new Error(`codex produced no agent_message.\n${stdout.slice(0, 300)}`));
        return;
      }
      resolve(text);
    });
  });

// ---------------------------------------------------------------------------
// launch — resume from a packet
// ---------------------------------------------------------------------------

export class CodexLiveSession implements LiveSession {
  readonly provider = "codex";
  private errorCbs: Array<(e: unknown) => void> = [];
  private stdout = "";
  private stderr = "";
  private _usage?: CodexUsage;
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
        if (/\b429\b|rate[ _-]?limit/i.test(all)) {
          this.fireError({ kind: "rate_limit", detail: all.slice(0, 200) });
        }
        if (code !== 0) {
          this.fireError({ kind: "crash", detail: `exit ${code}` });
          reject(new Error(`codex exited ${code}: ${this.stderr}`));
          return;
        }
        const { text, usage } = parseCodexJsonl(this.stdout);
        this._usage = usage;
        resolve(text || this.stdout);
      });
    });
  }

  private fireError(e: unknown) {
    for (const cb of this.errorCbs) cb(e);
  }

  usage(): SessionUsage {
    const tokens = this._usage
      ? this._usage.input_tokens + this._usage.output_tokens
      : Math.ceil(this.stdout.length / 4);
    return { tokens, window: 272_000 };
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

export const codexAdapter: ProviderAdapter = {
  provider: "codex",
  compress: codexCompress,
  launch(opts: LaunchOptions): Promise<LiveSession> {
    if (!opts.manifestPath) {
      throw new Error("codexAdapter.launch requires opts.manifestPath (the handoff packet to resume from).");
    }
    const packet = HandoffPacket.parse(
      JSON.parse(fs.readFileSync(opts.manifestPath, "utf-8"))
    );
    const prompt = buildContinuationPrompt(packet);

    const child = spawn("codex", codexArgs(opts.model, opts.workspace, prompt), {
      cwd: opts.workspace,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return Promise.resolve(new CodexLiveSession(opts.model, child));
  },
};
