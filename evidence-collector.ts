/**
 * RelayIDE — Evidence Collector
 * -----------------------------
 * Assembles a validated `EvidenceBundle` (@relay/shared) — the single input the
 * Distiller consumes. It merges two sources:
 *   1. FRESH git facts, pulled on demand here (branch, status, diff, files).
 *   2. EPHEMERAL runtime facts, supplied by the caller (the orchestrator) —
 *      goal, acceptance criteria, command history, the latest failure, and a
 *      terminal excerpt. These can't be re-pulled from git; they were recorded
 *      live as the agent ran.
 *
 * Pure read: touches git + the changed files only; never writes.
 */

import { EvidenceBundle, CommandResult } from "./packages/shared";
import { captureWorkspace, safeExec } from "./extract";

/**
 * The live/session context the orchestrator passes in — the half of the
 * evidence that git cannot provide. In the test harness this is faked from the
 * mock files; in production the orchestrator fills it from the running session.
 */
export interface RuntimeContext {
  sessionId: string;
  goal: string; // the original ask
  acceptanceCriteria: string[];
  commands: CommandResult[]; // recorded as the agent ran them
  latestFailure: string | null; // most recent failing output
  relevantTerminalExcerpt: string; // bounded recent terminal context
}

/** Produce a validated EvidenceBundle for `dir` given the runtime context. */
export function collectEvidence(
  dir: string,
  runtime: RuntimeContext
): EvidenceBundle {
  const snapshot = captureWorkspace(dir); // fresh git diff + changed files
  const branch =
    safeExec("git rev-parse --abbrev-ref HEAD", dir) || "(unknown)";
  const gitStatus = safeExec("git status --porcelain", dir);

  return EvidenceBundle.parse({
    sessionId: runtime.sessionId,
    goal: runtime.goal,
    acceptanceCriteria: runtime.acceptanceCriteria,
    branch,
    gitStatus,
    gitDiff: snapshot.gitDiff,
    changedFiles: snapshot.changedFiles,
    commands: runtime.commands,
    latestFailure: runtime.latestFailure,
    relevantTerminalExcerpt: runtime.relevantTerminalExcerpt,
  });
}
