import { defineCommand } from "citty";
import { info } from "../output.js";
import { projectRoot } from "../project.js";
import { scan } from "./scan.js";

export default defineCommand({
  meta: { name: "check", description: "Fail when committed facts have drifted from current code" },
  args: {
    ci: { type: "boolean", description: "Use CI-friendly output and exit status" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const drift = await scan(projectRoot(args.root));
    if (!drift.length) return info("HarnessME check passed: no drift detected.");
    for (const item of drift) info(`::${item.severity === "error" ? "error" : "warning"} title=HarnessME ${item.category}::${item.message}`);
    process.exitCode = 1;
  },
});
