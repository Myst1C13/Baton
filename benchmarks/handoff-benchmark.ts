import { performance } from "node:perf_hooks";
import { distill, PacketMeta } from "../compressor";
import { HandoffPacket } from "../packages/shared";
import { benchmarkCases, BenchmarkCase } from "./fixtures";

export interface CaseResult {
  name: string;
  usedFallback: boolean;
  schemaValid: boolean;
  factsPassed: number;
  factsTotal: number;
  factRetentionPercent: number;
  sourceTokens: number;
  packetTokens: number;
  reductionPercent: number;
  durationMs: number;
}

export interface BenchmarkReport {
  benchmark: "baton-deterministic-handoff-v1";
  generatedAt: string;
  methodology: string;
  summary: {
    cases: number;
    fallbackCases: number;
    schemaValidityPercent: number;
    factRetentionPercent: number;
    medianReductionPercent: number;
    minimumReductionPercent: number;
  };
  results: CaseResult[];
}

function approxTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function claimsFor(testCase: BenchmarkCase): string {
  return JSON.stringify({
    goal: testCase.evidence.goal,
    acceptanceCriteria: testCase.evidence.acceptanceCriteria,
    status: "tests_failing",
    summary: `Work is blocked by ${testCase.evidence.latestFailure}.`,
    decisions: [{ text: "Keep executable evidence as the source of truth", source: "repository" }],
    constraints: ["Preserve existing behavior outside the failing path"],
    nextActions: [`Inspect ${testCase.evidence.changedFiles[0]}`, `Run ${testCase.verificationCommand}`],
    diffSummary: [`Changed ${testCase.evidence.changedFiles[0]}`],
    pitfalls: [`Do not ignore: ${testCase.evidence.latestFailure}`],
    focusFiles: [{
      path: testCase.evidence.changedFiles[0],
      role: "failing implementation path",
      state: "requires verification",
    }],
    confidence: 0.9,
  });
}

export async function runCase(testCase: BenchmarkCase): Promise<CaseResult> {
  const sourceTokens = approxTokens(testCase.evidence);
  const meta: PacketMeta = {
    sessionId: testCase.evidence.sessionId,
    sourceAgent: "claude",
    targetAgent: "codex",
    trigger: testCase.forceBackendFailure ? "crash" : "context_full",
    verificationCommand: testCase.verificationCommand,
    sourceTokens,
  };
  const start = performance.now();
  const originalWarn = console.warn;
  if (testCase.forceBackendFailure) console.warn = () => {};
  let packet;
  try {
    packet = await distill(testCase.evidence, meta, {
      backend: async () => {
        if (testCase.forceBackendFailure) throw new Error("benchmark provider outage");
        return claimsFor(testCase);
      },
      model: "deterministic-benchmark",
      cwd: process.cwd(),
    });
  } finally {
    console.warn = originalWarn;
  }
  const durationMs = Math.round((performance.now() - start) * 100) / 100;
  const schemaValid = HandoffPacket.safeParse(packet).success;
  const checks = [
    packet.task.goal === testCase.evidence.goal,
    JSON.stringify(packet.task.acceptanceCriteria) === JSON.stringify(testCase.evidence.acceptanceCriteria),
    JSON.stringify(packet.evidence.changedFiles) === JSON.stringify(testCase.evidence.changedFiles),
    JSON.stringify(packet.evidence.commands) === JSON.stringify(testCase.evidence.commands.map(({ command, exitCode }) => ({ command, exitCode }))),
    packet.evidence.latestFailure === testCase.evidence.latestFailure,
    packet.verificationCommand === testCase.verificationCommand,
  ];
  const factsPassed = checks.filter(Boolean).length;

  return {
    name: testCase.name,
    usedFallback: Boolean(testCase.forceBackendFailure),
    schemaValid,
    factsPassed,
    factsTotal: checks.length,
    factRetentionPercent: Math.round((factsPassed / checks.length) * 1000) / 10,
    sourceTokens,
    packetTokens: packet.metrics.packetTokens,
    reductionPercent: packet.metrics.reductionPercent,
    durationMs,
  };
}

export async function runBenchmark(cases: BenchmarkCase[] = benchmarkCases): Promise<BenchmarkReport> {
  const results: CaseResult[] = [];
  for (const testCase of cases) results.push(await runCase(testCase));
  const factsPassed = results.reduce((sum, result) => sum + result.factsPassed, 0);
  const factsTotal = results.reduce((sum, result) => sum + result.factsTotal, 0);
  return {
    benchmark: "baton-deterministic-handoff-v1",
    generatedAt: new Date().toISOString(),
    methodology: "Six synthetic, reproducible coding-failure fixtures compare serialized evidence with validated handoff packets. Fact retention checks goal, acceptance criteria, changed files, command exit codes, latest failure, and verification command. One fixture forces the model backend to fail.",
    summary: {
      cases: results.length,
      fallbackCases: results.filter((result) => result.usedFallback).length,
      schemaValidityPercent: Math.round((results.filter((result) => result.schemaValid).length / results.length) * 1000) / 10,
      factRetentionPercent: Math.round((factsPassed / factsTotal) * 1000) / 10,
      medianReductionPercent: percentile(results.map((result) => result.reductionPercent), 0.5),
      minimumReductionPercent: Math.min(...results.map((result) => result.reductionPercent)),
    },
    results,
  };
}

export function renderMarkdown(report: BenchmarkReport): string {
  const rows = report.results.map((result) =>
    `| ${result.name} | ${result.usedFallback ? "yes" : "no"} | ${result.schemaValid ? "pass" : "fail"} | ${result.factRetentionPercent}% | ${result.sourceTokens} → ${result.packetTokens} | ${result.reductionPercent}% |`
  ).join("\n");
  return `# Baton deterministic handoff benchmark\n\nGenerated: ${report.generatedAt}\n\n${report.methodology}\n\n## Summary\n\n- Schema validity: **${report.summary.schemaValidityPercent}%**\n- Deterministic fact retention: **${report.summary.factRetentionPercent}%**\n- Median context reduction: **${report.summary.medianReductionPercent}%**\n- Minimum context reduction: **${report.summary.minimumReductionPercent}%**\n- Forced backend-failure cases: **${report.summary.fallbackCases}/${report.summary.cases}**\n\n| Scenario | Fallback | Schema | Fact retention | Est. tokens | Reduction |\n|---|---:|---:|---:|---:|---:|\n${rows}\n\nToken counts use the repository's documented four-characters-per-token estimate. This suite measures deterministic packet integrity and payload reduction, not model quality or end-to-end coding success.\n`;
}
