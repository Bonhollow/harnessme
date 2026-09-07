import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { defineCommand } from "citty";
import { exists } from "@harnessme/core";
import { createProgress, info } from "../output.js";
import { projectRoot } from "../project.js";

const require = createRequire(import.meta.url);

async function installLefthook(root: string): Promise<void> {
  const executable = process.execPath;
  const script = require.resolve("lefthook/bin/index.js");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [script, "install"], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Lefthook installation failed with exit code ${code ?? "unknown"}.`)));
  });
}

const install = defineCommand({
  meta: { name: "install", description: "Install the generated local Git safety gate" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const root = projectRoot(args.root);
    if (!await exists(join(root, ".git"))) throw new Error("Git hooks require a Git repository.");
    if (!await exists(join(root, "lefthook.yml"))) throw new Error("Run `harnessme init` or `harnessme sync` first.");
    const progress = createProgress(2);
    progress.step("Installing the local pre-commit safety gate");
    await installLefthook(root);
    progress.done("Git safety gate installed");
    if (!await exists(join(root, ".git", "hooks", "pre-commit"))) throw new Error("Lefthook finished without creating .git/hooks/pre-commit.");
    info("Installed the HarnessME pre-commit critical-path gate.");
  },
});

const status = defineCommand({
  meta: { name: "status", description: "Report whether the local Git gate is installed" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const installed = await exists(join(projectRoot(args.root), ".git", "hooks", "pre-commit"));
    info(installed ? "HarnessME Git gate is installed." : "HarnessME Git gate is not installed. Run `harnessme hooks install`.");
    if (!installed) process.exitCode = 1;
  },
});

export default defineCommand({
  meta: { name: "hooks", description: "Manage local Git safety gates" },
  subCommands: { install, status },
});
