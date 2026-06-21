/**
 * RelayIDE — Provider-neutral contracts
 * -------------------------------------
 * The seam that makes model-switching SYMMETRIC. Nothing here names a concrete
 * provider — every provider (Claude, Gemini, Codex), INCLUDING the initial one,
 * is just an implementation of `ProviderAdapter`. The orchestrator, compressor
 * core, triggers, and router all speak these interfaces and never special-case
 * one provider as a "home base". There is no Claude-first assumption anywhere.
 *
 * Step 1 wires only `CompressBackend` (so the compressor stops hardcoding
 * `claude -p`). `LiveSession` and `ProviderAdapter.launch` are DEFINED here now
 * and IMPLEMENTED in later steps (injection, metering, transcript reading).
 */

import { WorkspaceSnapshot } from "./extract";

// ---------------------------------------------------------------------------
// Switch signalling — triggers raise a reason, the router maps it to a target
// ---------------------------------------------------------------------------

export type SwitchReason =
  | { kind: "context_full" }
  | { kind: "rate_limit" }
  | { kind: "outage" }
  | { kind: "crash"; detail: string }
  | { kind: "cost" }
  | { kind: "manual"; target?: RouteTarget };

export interface RouteTarget {
  provider: string; // "claude" | "gemini" | "codex" | …
  model: string;
}

export interface Router {
  /** Pure: a reason (+ context) → where to land. Owned by the routing team. */
  route(
    reason: SwitchReason,
    ctx: { current: RouteTarget; snapshot: WorkspaceSnapshot }
  ): RouteTarget;
}

// ---------------------------------------------------------------------------
// Compression backend — ONE headless summarization call on some provider
// ---------------------------------------------------------------------------

export interface CompressOptions {
  model: string; // which model performs the compression
  cwd: string; // workspace dir (some backends run as a child process here)
}

/**
 * Takes the assembled prompt, returns the model's raw reply (expected to
 * contain the JSON manifest). Provider-specific; lives in an adapter. This is
 * the seam that lets compression run on whatever provider is currently UP —
 * the primary may be the very thing that's rate-limited.
 */
export type CompressBackend = (
  prompt: string,
  opts: CompressOptions
) => Promise<string>;

// ---------------------------------------------------------------------------
// Live session — a running session of some provider (implemented per-adapter)
// ---------------------------------------------------------------------------

export interface SessionUsage {
  tokens: number; // tokens currently in context
  window: number; // the model's context window
}

export interface ConversationSlice {
  ask: string; // the original first user message — the INTENT anchor
  tail: string[]; // the most recent turns — current focus
}

export interface LiveSession {
  readonly provider: string;
  readonly model: string;
  usage(): SessionUsage; // feeds the token / cost meters
  onError(cb: (err: unknown) => void): void; // feeds rate_limit / crash triggers
  readTranscript(): ConversationSlice; // feeds intent extraction
  stop(): void;
}

// ---------------------------------------------------------------------------
// Provider adapter — EVERYTHING provider-specific lives behind this interface
// ---------------------------------------------------------------------------

export interface LaunchOptions {
  model: string;
  workspace: string;
  manifestPath: string; // seed the fresh session with this handoff manifest
}

export interface ProviderAdapter {
  readonly provider: string;
  /** Boot a fresh session of this provider, seeded with a handoff manifest. */
  launch(opts: LaunchOptions): Promise<LiveSession>;
  /** Headless one-shot summarization on this provider (the compression backend). */
  compress: CompressBackend;
}
