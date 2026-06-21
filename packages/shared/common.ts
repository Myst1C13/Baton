/**
 * RelayIDE — Shared primitives
 * ----------------------------
 * Small types reused across the evidence, handoff, and event schemas.
 */

import { z } from "zod";

/**
 * Providers in scope for the hackathon.
 *
 * NOTE — deviation from the locked doc: the spec types `sourceAgent: "claude"`
 * and `targetAgent: "codex"` as fixed literals, which only encodes a one-way
 * claude→codex handoff. We use this enum for BOTH ends so switching is
 * bidirectional (claude→codex AND codex→claude), matching the "switch back and
 * forth" goal. Same two-provider scope, just not one-directional.
 */
export const AgentId = z.enum(["claude", "codex"]);
export type AgentId = z.infer<typeof AgentId>;
