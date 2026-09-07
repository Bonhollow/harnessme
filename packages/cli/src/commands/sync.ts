import { defineCommand } from "citty";
import { syncHarness } from "@harnessme/renderers";
import { info } from "../output.js";
import { projectRoot, providerValues } from "../project.js";

export default defineCommand({
  meta: { name: "sync", description: "Render provider files from the validated facts store" },
  args: {
    targets: { type: "string", description: "Override configured output targets for this render" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const result = await syncHarness(projectRoot(args.root), providerValues(args.targets));
    info(`Synchronized ${result.targets.join(", ")}: ${result.files.join(", ")}.`);
  },
});
