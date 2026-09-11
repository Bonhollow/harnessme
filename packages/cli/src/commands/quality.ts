import { defineCommand } from "citty";
import { join } from "node:path";
import { assessHarnessQuality, readFacts, readText } from "@harnessme/core";
import { info } from "../output.js";
import { projectRoot } from "../project.js";

export default defineCommand({
  meta: { name: "quality", description: "Score the current harness and show missing operational guidance" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const root = projectRoot(args.root);
    const facts = await readFacts(root);
    const quality = assessHarnessQuality(facts, facts.documentationConflicts ?? [], await readText(join(root, "AGENTS.md")));
    const passed = quality.checks.filter((check) => check.passed).length;
    info(`Harness quality: ${quality.score}/100 · ${quality.grade} · confidence ${quality.confidence}% · ${passed}/${quality.checks.length} checks at target`);
    for (const dimension of quality.dimensions) info(`${dimension.label.padEnd(14)} ${String(dimension.score).padStart(3)}%  ${dimension.earned}/${dimension.maxPoints} pts  ${dimension.summary}`);
    for (const metric of quality.metrics) info(`${metric.label.padEnd(18)} ${String(metric.percentage).padStart(3)}%  ${metric.value}/${metric.target} ${metric.detail}`);
    for (const finding of quality.findings) info(`${finding.severity.toUpperCase()} ${finding.dimension}: ${finding.message} Next: ${finding.action}`);
  },
});
