import assert from "node:assert/strict";
import test from "node:test";
import { benchmarkCases } from "../benchmarks/fixtures";
import { renderMarkdown, runBenchmark, runCase } from "../benchmarks/handoff-benchmark";

test("benchmark retains deterministic evidence when the provider succeeds", async () => {
  const result = await runCase(benchmarkCases[0]);
  assert.equal(result.schemaValid, true);
  assert.equal(result.factRetentionPercent, 100);
  assert.ok(result.reductionPercent > 0);
});

test("benchmark retains deterministic evidence during provider failure", async () => {
  const result = await runCase(benchmarkCases.at(-1)!);
  assert.equal(result.usedFallback, true);
  assert.equal(result.schemaValid, true);
  assert.equal(result.factRetentionPercent, 100);
});

test("benchmark aggregates six reproducible scenarios", async () => {
  const report = await runBenchmark();
  assert.equal(report.summary.cases, 6);
  assert.equal(report.summary.fallbackCases, 1);
  assert.equal(report.summary.schemaValidityPercent, 100);
  assert.equal(report.summary.factRetentionPercent, 100);
  assert.match(renderMarkdown(report), /Median context reduction/);
});
