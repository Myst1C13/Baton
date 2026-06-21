/**
 * RelayIDE — Handoff Packet (locked shared contract)
 * --------------------------------------------------
 * The small, validated, distilled summary passed to the next agent. This is the
 * OUTPUT of the Distiller — built FROM an EvidenceBundle. It carries only what
 * the next agent cannot re-derive from disk: intent, state, decisions, the few
 * files that matter, and what NOT to do.
 *
 * Produced by: distiller.ts (your compressor.ts).
 * Consumed by: the orchestrator (stores it + hands it to the next adapter) and
 *              the UI's HandoffViewer.
 */

import { z } from "zod";
import { AgentId } from "./common";

/** Why the handoff fired (matches the four triggers in the spec). */
export const HandoffTrigger = z.enum([
  "manual",
  "rate_limit",
  "crash",
  "context_full",
]);
export type HandoffTrigger = z.infer<typeof HandoffTrigger>;

export const HandoffStatus = z.enum([
  "in_progress",
  "blocked",
  "tests_failing",
]);
export type HandoffStatus = z.infer<typeof HandoffStatus>;

/** A command summarised into the packet (no full output — that's evidence). */
export const PacketCommand = z.object({
  command: z.string(),
  exitCode: z.number().nullable(),
});

/** A decision already made, tagged by where it came from. */
export const Decision = z.object({
  text: z.string(),
  source: z.enum(["user", "repository", "agent"]),
});

/** Token-reduction + confidence metrics — the demo's headline numbers. */
export const Metrics = z.object({
  sourceTokens: z.number(),
  packetTokens: z.number(),
  reductionPercent: z.number(),
  confidence: z.number(), // 0..1
});

/** EXTENSION — a curated pointer so the next agent doesn't re-read the repo. */
export const FocusFile = z.object({
  path: z.string(),
  role: z.string(),
  state: z.string(),
});

export const HandoffPacket = z.object({
  version: z.literal("1.0"),
  sessionId: z.string(),
  sourceAgent: AgentId, // ← enum, not literal, so handoffs are bidirectional
  targetAgent: AgentId,
  trigger: HandoffTrigger,

  task: z.object({
    goal: z.string(),
    acceptanceCriteria: z.array(z.string()),
  }),

  state: z.object({
    status: HandoffStatus,
    summary: z.string(),
  }),

  evidence: z.object({
    changedFiles: z.array(z.string()),
    commands: z.array(PacketCommand),
    latestFailure: z.string().nullable(),
    diffSummary: z.array(z.string()),
  }),

  decisions: z.array(Decision),
  constraints: z.array(z.string()),
  nextActions: z.array(z.string()),
  verificationCommand: z.string(),
  metrics: Metrics,

  // --- Extensions beyond the locked doc (optional; confirm with the team) ----
  // The failure-memory differentiator: explicit "do NOT do X" derived from the
  // crash. Has no home in the doc's packet; added here so it isn't lost.
  pitfalls: z.array(z.string()).default([]),
  // Curated file pointers (anti re-read). Defaults empty so a sparse packet
  // still validates.
  focusFiles: z.array(FocusFile).default([]),
});
export type HandoffPacket = z.infer<typeof HandoffPacket>;
