import { join } from "node:path";
import { defineCommand } from "citty";
import { atomicWrite, harnessDir, readText } from "@harnessme/core";
import { createProgress, info } from "../output.js";
import { projectRoot } from "../project.js";
import { updateHarness } from "../harness-update.js";

const add = defineCommand({
  meta: { name: "add", description: "Append a maintainer-authored directive" },
  args: {
    text: { type: "positional", description: "Directive text", required: true },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const progress = createProgress(3);
    progress.step("Recording the maintainer directive");
    const entry = `\n## ${new Date().toISOString().slice(0, 10)}\n\n${args.text.trim()}\n`;
    progress.step("Regenerating agent integrations");
    await updateHarness(root, async (stagedRoot) => {
      const path = join(harnessDir(stagedRoot), "facts", "directives.md");
      const current = await readText(path);
      await atomicWrite(path, `${current.trimEnd()}${entry}`);
    });
    progress.done("Directive applied");
    info("Directive added and provider files synchronized.");
  },
});

const list = defineCommand({
  meta: { name: "list", description: "Print maintainer-authored directives" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    info((await readText(join(harnessDir(projectRoot(args.root)), "facts", "directives.md"))).trim());
  },
});

export default defineCommand({
  meta: { name: "directive", description: "Manage prescriptive project directives" },
  subCommands: { add, list },
});
