import { spawn } from "node:child_process";
import { join } from "node:path";
import { defineCommand } from "citty";
import { atomicWrite, readFacts } from "@harnessme/core";
import { renderForceGraphHtml } from "@harnessme/renderers";
import { info } from "../output.js";
import { projectRoot } from "../project.js";

async function launch(path: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("spawn", () => { child.unref(); resolve(); });
    child.once("error", reject);
  });
}

export async function openForceGraph(root: string, openBrowser = true): Promise<string> {
  const graph = (await readFacts(root)).knowledgeGraph;
  if (!graph) throw new Error("No knowledge graph exists. Run `harnessme refresh` or `harnessme sync` first.");
  const path = join(root, ".harnessme", "graph.html");
  await atomicWrite(path, renderForceGraphHtml(graph));
  if (openBrowser) await launch(path);
  return path;
}

export default defineCommand({
  meta: { name: "graph", description: "Open the interactive 3D force-directed knowledge graph" },
  args: {
    print: { type: "boolean", description: "Generate and print the HTML path without opening a browser" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const path = await openForceGraph(projectRoot(args.root), !args.print);
    info(args.print ? path : `Opened 3D knowledge graph: ${path}`);
  },
});
