import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { defineCommand } from "citty";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  assessHarnessQuality,
  atomicWrite,
  classifyRisk,
  harnessDir,
  matchingCriticalPath,
  readCriticalPaths,
  readFacts,
  readText,
  resolveChangeContext,
  resolveRepositoryPreflight,
} from "@harnessme/core";
import { nonCodingClientInstructions } from "@harnessme/renderers";
import { projectRoot } from "../project.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function result(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown): ToolResult {
  return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
}

function safeRelativePath(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/^\.\//u, "").trim();
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//u.test(path) || path.split("/").includes("..")) {
    throw new Error(`Path must stay inside the repository: ${value}`);
  }
  return path;
}

async function runHarnessCommand(root: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const entry = process.argv[1];
  if (!entry) throw new Error("Could not locate the HarnessME CLI entrypoint.");
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

export function createHarnessMcpServer(root: string): McpServer {
  const server = new McpServer(
    { name: "harnessme", version: "0.18.1" },
    { instructions: nonCodingClientInstructions },
  );

  server.registerTool("harnessme_preflight", {
    title: "HarnessME repository preflight",
    description: "Required before any repository edit or Git/PR action. Returns root and nearest scoped instructions, critical-path approval requirements, change context, and validation guidance.",
    inputSchema: {
      paths: z.array(z.string().min(1)).min(1).max(20).describe("Every repository-relative path intended for the edit or affected by the Git/PR action."),
      action: z.enum(["edit", "git", "pull-request"]).describe("The action that will follow this preflight."),
    },
    annotations: { readOnlyHint: true },
  }, async ({ paths, action }) => {
    try {
      const facts = await readFacts(root);
      return result(await resolveRepositoryPreflight(root, facts, await readCriticalPaths(root), paths, action));
    } catch (error) { return failure(error); }
  });

  server.registerTool("harnessme_quality", {
    title: "HarnessME quality report",
    description: "Read the current HarnessME quality score, checks, dimensions, and remediation findings.",
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const facts = await readFacts(root);
      return result(assessHarnessQuality(facts, facts.documentationConflicts ?? [], await readText(join(root, "AGENTS.md"))));
    } catch (error) { return failure(error); }
  });

  server.registerTool("harnessme_change_context", {
    title: "HarnessME change context",
    description: "Resolve ownership, linked guides, dependencies, focused tests, critical paths, and validation commands for repository paths.",
    inputSchema: { paths: z.array(z.string().min(1)).min(1).max(20).describe("Repository-relative paths to inspect.") },
    annotations: { readOnlyHint: true },
  }, async ({ paths }) => {
    try { return result(resolveChangeContext(await readFacts(root), paths)); } catch (error) { return failure(error); }
  });

  server.registerTool("harnessme_critical_paths", {
    title: "HarnessME critical paths",
    description: "Read active and proposed critical-path rules, approvers, risk categories, rollback guidance, and approval records.",
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      return result({
        paths: await readCriticalPaths(root),
        manifest: JSON.parse(await readText(join(harnessDir(root), "critical.json"))) as unknown,
      });
    } catch (error) { return failure(error); }
  });

  server.registerTool("harnessme_feature_graph", {
    title: "HarnessME feature graph",
    description: "Read the repository feature and dependency graph, including generated feature definitions and diagnostics.",
    annotations: { readOnlyHint: true },
  }, async () => {
    try {
      const facts = await readFacts(root);
      return result({ features: facts.featurePack, graph: facts.knowledgeGraph, diagnostics: facts.knowledgeGraph?.diagnostics ?? [] });
    } catch (error) { return failure(error); }
  });

  server.registerTool("harnessme_validation_plan", {
    title: "HarnessME validation plan",
    description: "Return the verified repository validation commands, optionally narrowed with change context for selected paths.",
    inputSchema: { paths: z.array(z.string().min(1)).max(20).optional().describe("Optional repository-relative paths to scope the plan.") },
    annotations: { readOnlyHint: true },
  }, async ({ paths }) => {
    try {
      const facts = await readFacts(root);
      return result(paths?.length
        ? resolveChangeContext(facts, paths)
        : { validationCommands: facts.stack.validationCommands ?? [], warnings: facts.stack.validationCommands?.length ? [] : ["No verified validation commands are available."] });
    } catch (error) { return failure(error); }
  });

  server.registerTool("harnessme_draft_critical_record", {
    title: "Draft a critical-change record",
    description: "Create a draft record for a registered critical path after the developer has explicitly confirmed the edit. This never approves a change.",
    inputSchema: {
      path: z.string().min(1).describe("Repository-relative critical file path."),
      summary: z.string().min(1).max(500).describe("Short intended-change summary."),
      developerConfirmed: z.literal(true).describe("Must be true only after explicit developer confirmation."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ path: suppliedPath, summary }) => {
    try {
      const path = safeRelativePath(suppliedPath);
      const rule = matchingCriticalPath(await readCriticalPaths(root), path);
      if (!rule) throw new Error(`${path} is not registered as an active critical path.`);
      const date = new Date().toISOString().slice(0, 10);
      const slug = summary.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "change";
      const suffix = createHash("sha256").update(`${path}:${summary}`, "utf8").digest("hex").slice(0, 8);
      const file = `${date}-${slug}-${suffix}.md`;
      const content = `---\nstatus: draft\npath: ${path}\nrisk: ${rule.risk ?? classifyRisk(path)}\napprovers:\n${rule.approvers.map((approver) => `  - ${approver}`).join("\n")}\ndate: ${date}\nsummary: ${JSON.stringify(summary)}\nchange-id: pending\n---\n\n## Context\n\n[why this change is needed]\n\n## Decision\n\n[what changed, in plain language]\n\n## Impact\n\n[what else depends on this / could break]\n\n## Rollback\n\n[how to revert safely]\n`;
      await atomicWrite(join(harnessDir(root), "critical-log", file), content);
      return result({ record: `.harnessme/critical-log/${file}`, status: "draft", next: "A listed human approver must approve the exact staged content with `harnessme critical approve`." });
    } catch (error) { return failure(error); }
  });

  server.registerTool("harnessme_add_directive", {
    title: "Add a HarnessME directive",
    description: "Append a maintainer-authored directive and synchronize generated agent integrations.",
    inputSchema: { text: z.string().min(1).max(10_000).describe("Maintainer directive text."), confirm: z.literal(true).describe("Must be true to write the directive.") },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ text }) => {
    try {
      const path = join(harnessDir(root), "facts", "directives.md");
      const current = await readText(path);
      await atomicWrite(path, `${current.trimEnd()}\n\n## ${new Date().toISOString().slice(0, 10)}\n\n${text.trim()}\n`);
      // Ruler writes progress directly to stdout. Run synchronization in a child so
      // its output cannot corrupt this process's JSON-RPC stdout transport.
      const execution = await runHarnessCommand(root, ["sync", "--root", root]);
      if (execution.code !== 0) throw new Error(`HarnessME sync failed (exit ${execution.code}): ${execution.stderr.trim().slice(-2_000)}`);
      return result({ updated: ".harnessme/facts/directives.md", synchronized: true, diagnostics: execution.stderr.trim() });
    } catch (error) { return failure(error); }
  });

  server.registerTool("harnessme_refresh", {
    title: "Refresh HarnessME",
    description: "Reanalyze the repository and regenerate the HarnessME guidance. Requires explicit confirmation because it writes managed artifacts.",
    inputSchema: { confirm: z.literal(true).describe("Must be true to run refresh."), deterministic: z.boolean().default(false).describe("Use deterministic-only analysis instead of the configured AI provider.") },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ deterministic }) => {
    try {
      const args = ["refresh", "--root", root];
      if (deterministic) args.push("--deterministic");
      const execution = await runHarnessCommand(root, args);
      if (execution.code !== 0) throw new Error(`HarnessME refresh failed (exit ${execution.code}): ${execution.stderr.trim().slice(-2_000)}`);
      return result({ refreshed: true, output: execution.stdout.trim(), diagnostics: execution.stderr.trim() });
    } catch (error) { return failure(error); }
  });

  return server;
}

export default defineCommand({
  meta: { name: "mcp", description: "Run HarnessME as a local stdio Model Context Protocol server" },
  args: { root: { type: "string", description: "Repository root served by this MCP process", valueHint: "path" } },
  async run({ args }) {
    const server = createHarnessMcpServer(projectRoot(args.root));
    await server.connect(new StdioServerTransport());
  },
});
