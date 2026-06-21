/**
 * RelayIDE — Workspace Extraction (shared)
 * ----------------------------------------
 * The single source of truth for turning a workspace directory into a
 * structured snapshot: git diff + changed-file list + per-file code skeletons
 * + change stats. Both the on-demand compressor (pull, at freeze time) and the
 * live monitor (push, on every save) import from here so the extraction logic
 * never drifts between them.
 *
 * Stateless and dependency-free (Node built-ins only). Git is the source of
 * truth for the diff — we never cache it, we re-derive it from `git` each call.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The structural lines extracted from one changed source file. */
export interface Skeleton {
  path: string; // repo-relative path
  lines: string[]; // declaration lines only (bodies stripped)
}

/** Aggregate churn numbers, useful for the monitor's pressure signal. */
export interface DiffStats {
  filesChanged: number;
  additions: number; // added lines in the working-tree diff
  deletions: number; // removed lines
  diffBytes: number; // raw size of the diff text
}

/** A complete, point-in-time capture of the workspace's changed state. */
export interface WorkspaceSnapshot {
  capturedAt: string; // ISO timestamp of this capture
  gitDiff: string; // `git diff` against HEAD (working-tree changes)
  changedFiles: string[]; // modified/added .ts/.tsx files (from porcelain)
  skeletons: Skeleton[]; // structural skeleton per changed file
  stats: DiffStats;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a shell command synchronously inside `dir` and return stdout. Never
 * throws on a non-zero exit (e.g. `git diff` on an empty repo) — we just want
 * whatever the tool managed to print.
 */
export function safeExec(cmd: string, dir: string): string {
  try {
    return execSync(cmd, {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 20 * 1024 * 1024, // 20MB — diffs can be large
    }).trim();
  } catch (err: any) {
    // execSync throws on non-zero exit; the captured stdout still lives on err.
    return (err?.stdout?.toString() || "").trim();
  }
}

/**
 * Extract ONLY the structural lines from a source file — imports, exports,
 * class / interface / function / type declarations — discarding inner logic.
 * A deliberately cheap "regex AST": fast, dependency-free, good enough to map
 * the code surface without burning tokens on bodies. (Upgrade path: swap this
 * for the TypeScript Compiler API for a true, nesting-aware AST.)
 */
export function extractSkeleton(fileContents: string): string[] {
  const SKELETON_RE =
    /^\s*(import\s.+|export\s.+|(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s.+|(?:export\s+)?interface\s.+|(?:export\s+)?(?:async\s+)?function\s.+|(?:export\s+)?type\s.+=.*)/;

  return fileContents
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => SKELETON_RE.test(line));
}

/** Parse changed .ts/.tsx paths out of `git status --porcelain` output. */
function parseChangedFiles(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter(Boolean)
    // Strip the porcelain status field robustly: optional leading whitespace
    // (the overall output may have been trimmed), then 1-2 status symbols, then
    // the separating whitespace. Works whether or not the leading space survived.
    .map((line) => {
      const pathPart = line.replace(/^\s*[MADRCU?!]{1,2}\s+/, "");
      const renameSplit = pathPart.split(" -> ");
      return (renameSplit.at(-1) ?? "").trim();
    })
    .filter((f) => /\.(ts|tsx)$/.test(f));
}

/** Count added/removed lines directly from diff text (no extra git call). */
function countDiffLines(gitDiff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of gitDiff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture the workspace's changed state: diff, changed files, skeletons, stats.
 * Pure read — touches git and the changed files only, never writes anything.
 */
export function captureWorkspace(dir: string): WorkspaceSnapshot {
  const gitDiff = safeExec("git diff", dir);
  const changedFiles = parseChangedFiles(safeExec("git status --porcelain", dir));

  const skeletons: Skeleton[] = [];
  for (const file of changedFiles) {
    const abs = path.join(dir, file);
    if (!fs.existsSync(abs)) continue; // deleted file — nothing to read
    try {
      const lines = extractSkeleton(fs.readFileSync(abs, "utf-8"));
      if (lines.length) skeletons.push({ path: file, lines });
    } catch {
      /* unreadable file — skip silently */
    }
  }

  const { additions, deletions } = countDiffLines(gitDiff);

  return {
    capturedAt: new Date().toISOString(),
    gitDiff,
    changedFiles,
    skeletons,
    stats: {
      filesChanged: changedFiles.length,
      additions,
      deletions,
      diffBytes: Buffer.byteLength(gitDiff, "utf-8"),
    },
  };
}

/**
 * Render skeletons into the single annotated string the compressor prompt
 * expects: one `// FILE: <path>` header per file followed by its declarations.
 */
export function formatSkeletons(skeletons: Skeleton[]): string {
  return (
    skeletons
      .map((s) => `// FILE: ${s.path}\n${s.lines.join("\n")}`)
      .join("\n\n") || "(no structural lines in changed TS files)"
  );
}
