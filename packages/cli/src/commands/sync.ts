import { defineCommand } from "citty";
import { previewHarnessSync, syncHarness } from "@harnessme/renderers";
import { createProgress, info } from "../output.js";
import { projectRoot, providerValues } from "../project.js";

export default defineCommand({
  meta: { name: "sync", description: "Render provider files from the validated facts store" },
  args: {
    targets: { type: "string", description: "Override configured output targets for this render" },
    preview: { type: "boolean", description: "Show generated-document changes without writing" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const targets = providerValues(args.targets);
    if (args.preview) {
      const changes = await previewHarnessSync(root, targets);
      if (!changes.length) return info("No generated-document changes detected.");
      for (const change of changes) info(`${change.status.toUpperCase()} ${change.path}  +${change.additions} -${change.deletions}`);
      return;
    }
    const progress = createProgress(2);
    progress.step("Generating agent instructions and governance files");
    const result = await syncHarness(root, targets);
    progress.done("Synchronization complete");
    info(`Synchronized ${result.targets.join(", ")}: ${result.files.join(", ")}.`);
  },
});
