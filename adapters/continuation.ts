/**
 * RelayIDE — Continuation prompt (provider-neutral)
 * -------------------------------------------------
 * Turns a HandoffPacket into the opening prompt of a resumed session. Shared by
 * every provider adapter so a Claude-produced packet and a Codex-produced packet
 * are framed identically when read by whichever model resumes.
 */

import { HandoffPacket } from "../packages/shared";

export function buildContinuationPrompt(packet: HandoffPacket): string {
  return `Continue an unfinished coding task using the RelayIDE handoff packet below. You have the full repository on disk — treat the git diff, files, and command results as the source of truth. Do NOT redo completed work or broaden the scope.

State your resume plan in plain text, concisely:
1. GOAL — what you are resuming
2. DONE — what is already complete (do not redo it)
3. NEXT — your single next concrete action
4. AVOID — what you must NOT do, per the packet's pitfalls

Then describe the smallest safe change you would make and the verification command you would run. This is a resume check — describe the plan; do not edit files in this turn.

[HANDOFF PACKET]
${JSON.stringify(packet, null, 2)}`;
}
