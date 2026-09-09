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
    const failed = quality.checks.filter((check) => !check.passed);
    const rating = quality.score >= 90 ? "ready" : quality.score >= 70 ? "needs attention" : "needs work";
    info(`Harness quality: ${quality.score}/100 · ${rating} · ${passed}/${quality.checks.length} dimensions healthy`);
    for (const check of quality.checks) info(`${check.passed ? "✓" : "✗"} ${String(check.points).padStart(2, " ")} pts  ${check.message}`);
    if (failed.length) info(`Next best action: ${failed[0]?.message}`);
  },
});
