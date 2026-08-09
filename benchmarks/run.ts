import * as fs from "node:fs";
import * as path from "node:path";
import { renderMarkdown, runBenchmark } from "./handoff-benchmark";

async function main(): Promise<void> {
  const report = await runBenchmark();
  const outputDir = path.resolve("benchmarks/results");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "latest.md"), renderMarkdown(report));
  console.log(renderMarkdown(report));
  if (report.summary.schemaValidityPercent !== 100 || report.summary.factRetentionPercent !== 100) process.exitCode = 1;
}

void main();
