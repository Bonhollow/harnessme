import { createHash } from "node:crypto";
import { basename, isAbsolute, join, relative } from "node:path";
import { defineCommand } from "citty";
import matter from "gray-matter";
import {
  atomicWrite,
  classifyRisk,
  harnessDir,
  matchingCriticalPath,
  posixPath,
  readCriticalPaths,
  readText,
  stagedChangeId,
  writeYaml,
} from "@harnessme/core";
import { createProgress, info } from "../output.js";
import { projectRoot } from "../project.js";
import { syncHarness } from "@harnessme/renderers";

function handles(value: string): string[] {
  const result = value.split(",").map((item) => item.trim().replace(/^@/u, "")).filter(Boolean);
  if (!result.length) throw new Error("At least one approver is required.");
  return result;
}

function safeProjectRelative(root: string, value: string): string {
  const path = posixPath(isAbsolute(value) ? relative(root, value) : value).replace(/^\.\//u, "");
  if (!path || path === ".." || path.startsWith("../")) throw new Error(`Path is outside the repository: ${value}`);
  return path;
}

const add = defineCommand({
  meta: { name: "add", description: "Register a critical path glob" },
  args: {
    glob: { type: "positional", description: "Repository-relative glob", required: true },
    reason: { type: "string", description: "Why changes need review", required: true },
    approvers: { type: "string", description: "Comma-separated GitHub handles", required: true },
    risk: { type: "string", description: "Risk category: security, persistence, public-contract, billing, deployment, shared-core, or other" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const progress = createProgress(3);
    progress.step("Registering the critical-path rule");
    const glob = posixPath(args.glob);
    if (glob.startsWith("/") || /^[A-Za-z]:\//u.test(glob) || glob.split("/").includes("..")) {
      throw new Error("Critical globs must stay relative to the repository root.");
    }
    const config = await readCriticalPaths(root);
    const existing = config.paths.find((entry) => entry.glob === glob);
    if (existing?.status === "active") throw new Error(`Critical path already exists: ${glob}`);
    const allowedRisks = ["security", "persistence", "public-contract", "billing", "deployment", "shared-core", "other"] as const;
    const risk = args.risk ?? classifyRisk(glob);
    if (!allowedRisks.includes(risk as typeof allowedRisks[number])) throw new Error(`Unsupported risk category: ${risk}`);
    const rule = { glob, reason: args.reason, approvers: handles(args.approvers), source: "explicit" as const, status: "active" as const, risk: risk as typeof allowedRisks[number] };
    if (existing) Object.assign(existing, rule);
    else config.paths.push(rule);
    config.paths.sort((a, b) => a.glob.localeCompare(b.glob));
    await writeYaml(join(harnessDir(root), "critical-paths.yaml"), config);
    progress.step("Regenerating agent and governance integrations");
    await syncHarness(root);
    progress.done("Critical-path rule registered");
    info(`${existing ? "Promoted proposed" : "Registered"} ${glob}; updated agent instructions, hooks, and CODEOWNERS.`);
  },
});

const list = defineCommand({
  meta: { name: "list", description: "List critical path rules" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const config = await readCriticalPaths(projectRoot(args.root));
    if (!config.paths.length) return info("No explicit critical paths configured.");
    for (const entry of config.paths) info(`${entry.status}\t${entry.risk ?? "other"}\t${entry.glob}\t${entry.reason}\t${entry.approvers.map((item) => `@${item}`).join(",")}`);
  },
});

const activate = defineCommand({
  meta: { name: "activate", description: "Activate a proposed critical path after maintainer review" },
  args: {
    glob: { type: "positional", description: "Exact registered critical path glob", required: true },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const progress = createProgress(3);
    progress.step("Loading the proposed critical-path rule");
    const config = await readCriticalPaths(root);
    const rule = config.paths.find((entry) => entry.glob === posixPath(args.glob));
    if (!rule) throw new Error(`No proposed critical path exists for: ${args.glob}`);
    if (rule.status === "active") return info(`${rule.glob} is already active.`);
    rule.status = "active";
    await writeYaml(join(harnessDir(root), "critical-paths.yaml"), config);
    progress.step("Regenerating agent and governance integrations");
    await syncHarness(root);
    progress.done("Critical-path rule activated");
    info(`Activated ${rule.glob}; updated agent instructions, hooks, and CODEOWNERS.`);
  },
});

const draft = defineCommand({
  meta: { name: "draft", description: "Create a review record before editing a critical path" },
  args: {
    path: { type: "positional", description: "Repository-relative file path", required: true },
    summary: { type: "string", description: "Short intended-change summary", required: true },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const path = safeProjectRelative(root, args.path);
    const rule = matchingCriticalPath(await readCriticalPaths(root), path);
    if (!rule) throw new Error(`${path} is not registered as a critical path.`);
    const date = new Date().toISOString().slice(0, 10);
    const slug = args.summary.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "change";
    const suffix = createHash("sha256").update(`${path}:${args.summary}`, "utf8").digest("hex").slice(0, 8);
    const file = `${date}-${slug}-${suffix}.md`;
    const content = matter.stringify(
      `## Context\n\n[why this change is needed]\n\n## Decision\n\n[what changed, in plain language]\n\n## Impact\n\n[what else depends on this / could break]\n\n## Rollback\n\n[how to revert safely]\n`,
      { status: "draft", path, risk: rule.risk ?? classifyRisk(path), approvers: rule.approvers, date, summary: args.summary, "change-id": "pending" },
    );
    await atomicWrite(join(harnessDir(root), "critical-log", file), content);
    info(`Created .harnessme/critical-log/${file}. Review it, stage the code, then run \`harnessme critical approve ${file}\`.`);
  },
});

const approve = defineCommand({
  meta: { name: "approve", description: "Bind a reviewed critical record to staged file content" },
  args: {
    record: { type: "positional", description: "Critical-log filename", required: true },
    approver: { type: "string", description: "Approving GitHub handle", required: true },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const file = basename(args.record);
    if (file !== args.record || !file.endsWith(".md")) throw new Error("Record must be a filename from .harnessme/critical-log/.");
    const recordPath = join(harnessDir(root), "critical-log", file);
    const document = matter(await readText(recordPath));
    const path = typeof document.data.path === "string" ? document.data.path : "";
    if (!path) throw new Error(`Record has no valid path: ${file}`);
    const approver = args.approver.replace(/^@/u, "");
    const rule = matchingCriticalPath(await readCriticalPaths(root), safeProjectRelative(root, path));
    if (!rule) throw new Error(`${path} is no longer registered as a critical path.`);
    const allowed = rule.approvers.map((item) => item.replace(/^@/u, "")).includes(approver);
    if (!allowed) throw new Error(`@${approver} is not listed as an approver for ${path}.`);
    document.data.path = safeProjectRelative(root, path);
    document.data.approvers = rule.approvers;
    document.data.status = "approved";
    document.data["approved-by"] = approver;
    document.data["change-id"] = await stagedChangeId(root, path);
    await atomicWrite(recordPath, matter.stringify(document.content, document.data));

    const indexPath = join(harnessDir(root), "CRITICAL.md");
    const index = await readText(indexPath);
    const summary = String(document.data.summary).replaceAll("|", "\\|");
    const row = index.includes("| Date | Risk |")
      ? `| ${document.data.date} | ${rule.risk ?? classifyRisk(path)} | ${path} | ${summary} | @${approver} | ${document.data["change-id"]} |`
      : `| ${document.data.date} | ${path} | ${summary} | @${approver} | ${document.data["change-id"]} |`;
    if (!index.includes(String(document.data["change-id"]))) {
      await atomicWrite(indexPath, `${index.trimEnd()}\n${row}\n`);
    }
    info(`Approved ${file} for staged content ${document.data["change-id"]}. Stage this record and .harnessme/CRITICAL.md with the code.`);
  },
});

export default defineCommand({
  meta: { name: "critical", description: "Manage critical-path rules and review records" },
  subCommands: { add, list, activate, draft, approve },
});
