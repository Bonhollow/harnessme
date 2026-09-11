import { defineCommand } from "citty";
import { isAbsolute, relative } from "node:path";
import { posixPath, readFacts, renderChangeContext, resolveChangeContext, runGit } from "@harnessme/core";
import { info } from "../output.js";
import { projectRoot } from "../project.js";

async function changedPaths(root: string): Promise<string[]> {
  const [working, staged, untracked] = await Promise.all([
    runGit(root, ["diff", "--name-only"]),
    runGit(root, ["diff", "--cached", "--name-only"]),
    runGit(root, ["ls-files", "--others", "--exclude-standard"]),
  ]);
  if (working.code !== 0) throw new Error(`Cannot inspect changed files: ${(working.stderr || working.stdout).trim()}`);
  if (staged.code !== 0) throw new Error(`Cannot inspect staged files: ${(staged.stderr || staged.stdout).trim()}`);
  if (untracked.code !== 0) throw new Error(`Cannot inspect untracked files: ${(untracked.stderr || untracked.stdout).trim()}`);
  return [...new Set(`${working.stdout}\n${staged.stdout}\n${untracked.stdout}`.split(/\r?\n/u).map((path) => path.trim()).filter(Boolean))];
}

export default defineCommand({
  meta: { name: "context", description: "Resolve the operating context for files before editing" },
  args: {
    path: { type: "positional", required: false, description: "Repository path or comma-separated paths" },
    changed: { type: "boolean", description: "Resolve context for all currently changed files" },
    json: { type: "boolean", description: "Print structured JSON instead of Markdown" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const paths = (args.changed
      ? await changedPaths(root)
      : typeof args.path === "string" ? args.path.split(",").map((path) => path.trim()).filter(Boolean) : [])
      .map((path) => posixPath(isAbsolute(path) ? relative(root, path) : path));
    if (!paths.length) throw new Error(args.changed ? "No changed files were found." : "Provide a repository path or use --changed.");
    const context = resolveChangeContext(await readFacts(root), paths);
    info(args.json ? JSON.stringify(context, null, 2) : renderChangeContext(context));
  },
});
