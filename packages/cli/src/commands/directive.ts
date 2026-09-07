import { join } from "node:path";
import { defineCommand } from "citty";
import { atomicWrite, harnessDir, readText } from "@harnessme/core";
import { syncHarness } from "@harnessme/renderers";
import { info } from "../output.js";
import { projectRoot } from "../project.js";

const add = defineCommand({
  meta: { name: "add", description: "Append a maintainer-authored directive" },
  args: {
    text: { type: "positional", description: "Directive text", required: true },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const path = join(harnessDir(root), "facts", "directives.md");
    const current = await readText(path);
    const entry = `\n## ${new Date().toISOString().slice(0, 10)}\n\n${args.text.trim()}\n`;
    await atomicWrite(path, `${current.trimEnd()}${entry}`);
    await syncHarness(root);
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
