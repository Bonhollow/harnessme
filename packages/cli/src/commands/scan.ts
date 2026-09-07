import { defineCommand } from "citty";
import { readFacts, detectDrift } from "@harnessme/core";
import { analyzeProject } from "@harnessme/analyzers";
import { info, warn } from "../output.js";
import { projectRoot } from "../project.js";

export async function scan(root: string): Promise<ReturnType<typeof detectDrift>> {
  const facts = await readFacts(root);
  const current = await analyzeProject({ root, ...facts.config.analysis });
  for (const message of current.warnings) warn(message);
  return detectDrift(current, facts);
}

export default defineCommand({
  meta: { name: "scan", description: "Analyze current code and report drift without writing" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const drift = await scan(projectRoot(args.root));
    if (!drift.length) return info("No harness drift detected.");
    info(`Detected ${drift.length} drift item(s):`);
    for (const item of drift) info(`- [${item.severity}] ${item.category}: ${item.message}`);
  },
});
