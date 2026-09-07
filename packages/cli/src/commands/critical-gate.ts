import { defineCommand } from "citty";
import { changedPathsSince, evaluateCriticalGate, posixPath, stagedPaths } from "@harnessme/core";
import { evaluateClaudeHook } from "@harnessme/renderers";
import { info } from "../output.js";
import { projectRoot } from "../project.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

export default defineCommand({
  meta: { name: "critical-gate", description: "Block unreviewed changes to registered critical paths" },
  args: {
    path: { type: "string", description: "Path to check in edit phase" },
    hook: { type: "boolean", description: "Read Claude Code hook JSON from stdin" },
    base: { type: "string", description: "Git base revision for CI" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    if (args.hook) {
      const input = await readStdin();
      let parsed: unknown;
      try { parsed = JSON.parse(input); } catch { throw new Error("Claude hook input was not valid JSON."); }
      const response = await evaluateClaudeHook(root, parsed);
      if (response) process.stdout.write(response);
      return;
    }

    const paths = typeof args.path === "string"
      ? [posixPath(args.path)]
      : typeof args.base === "string"
        ? await changedPathsSince(root, args.base)
        : await stagedPaths(root);
    const result = typeof args.path === "string"
      ? await evaluateCriticalGate(root, { phase: "edit", paths })
      : await evaluateCriticalGate(root, {
        phase: "commit",
        paths,
        includedPaths: paths,
        source: typeof args.base === "string" ? "head" : "staged",
      });
    if (!result.failures.length) return info(`Critical gate passed for ${paths.length} path(s).`);
    for (const failure of result.failures) {
      process.stderr.write(`blocked: ${failure.path}: ${failure.reason}\n`);
      if (failure.code === "approval-required") {
        process.stderr.write(`Create a record with: harnessme critical draft "${failure.path}" --summary "<summary>"\n`);
      } else if (failure.code !== "confirmation-required") {
        process.stderr.write("Stage both the approved record and .harnessme/CRITICAL.md with the code change.\n");
      }
    }
    process.exitCode = 2;
  },
});
