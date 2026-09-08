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
    info(`Harness quality: ${quality.score}/100`);
    for (const check of quality.checks) info(`${check.passed ? "✓" : "✗"} ${check.message} (${check.points} points)`);
  },
});
