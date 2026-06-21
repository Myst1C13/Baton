/**
 * RelayIDE — Evidence Bundle (locked shared contract)
 * ---------------------------------------------------
 * The RAW facts gathered from the repo and terminal, BEFORE distillation. This
 * is the INPUT to the Distiller. Big and unprocessed; the Distiller turns it
 * into the small `HandoffPacket`.
 *
 * Produced by: evidence-collector.ts (your extract.ts).
 * Consumed by: distiller.ts.
 */

import { z } from "zod";

/** One executed command and its result (e.g. a test run). */
export const CommandResult = z.object({
  command: z.string(),
  exitCode: z.number().nullable(), // null = still running / unknown
  output: z.string(),
});
export type CommandResult = z.infer<typeof CommandResult>;

export const EvidenceBundle = z.object({
  sessionId: z.string(),
  goal: z.string(), // the original ask — the INTENT anchor
  acceptanceCriteria: z.array(z.string()),
  branch: z.string(),
  gitStatus: z.string(), // `git status --porcelain`
  gitDiff: z.string(), // `git diff`
  changedFiles: z.array(z.string()),
  commands: z.array(CommandResult), // recent commands + exit codes + output
  latestFailure: z.string().nullable(), // most recent failing output, if any
  relevantTerminalExcerpt: z.string(), // bounded recent terminal context
});
export type EvidenceBundle = z.infer<typeof EvidenceBundle>;
