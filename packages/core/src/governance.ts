import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import matter from "gray-matter";
import { minimatch } from "minimatch";
import yaml from "js-yaml";
import { z } from "zod";
import { gitText, runGit, runGitBytes } from "./git.js";
import { CriticalPathsSchema, type CriticalPaths } from "./schema.js";
import { posixPath, readText, readYaml, repositoryRelativePath, writeJson } from "./files.js";
import { protectedMethodsDefinedInPython, protectedMethodsFromDirectives } from "./directives.js";
import { isTestPath } from "./risk.js";

const CriticalRecordDataSchema = z.object({
  status: z.enum(["draft", "approved"]),
  path: z.string().min(1),
  date: z.preprocess(
    (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value),
    z.string(),
  ),
  approvers: z.array(z.string().min(1)),
  summary: z.string().min(1),
  "change-id": z.string().min(1).default("pending"),
  "approved-by": z.string().min(1).optional(),
});

export type CriticalRecordStatus = "draft" | "approved";

export interface CriticalRecord {
  file: string;
  status: CriticalRecordStatus;
  path: string;
  date: string;
  approvers: string[];
  changeId: string;
  summary: string;
  approvedBy?: string;
}

export interface CriticalMatch {
  path: string;
  reason: string;
  approvers: string[];
}

export interface GateFailure {
  path: string;
  reason: string;
  code: "confirmation-required" | "approval-required" | "missing-gate" | "record-not-in-change" | "index-not-in-change" | "manifest-not-in-change";
}

export type CriticalGateRequest =
  | { phase: "edit"; paths: string[] }
  | { phase: "commit"; paths: string[]; includedPaths: string[]; source: "staged" | "head"; base?: string };

export interface CriticalGateResult {
  checkedPaths: string[];
  critical: CriticalMatch[];
  failures: GateFailure[];
}

export const criticalRollbackSteps = [
  "Contain the impact and preserve the current critical record and deployment evidence before changing state.",
  "Identify the last known-good revision and all affected consumers, data, migrations, and operational dependencies.",
  "Create and approve a new critical-change record for the rollback; do not bypass the critical-path gate during an incident.",
  "Prefer a revert of the deployed change or a forward-compatible corrective change. Do not rewrite shared history or destroy data as a rollback shortcut.",
  "Validate the restored behavior, compatibility, and data integrity with the repository's verified checks, then document the outcome in the rollback record.",
] as const;

export async function readCriticalPaths(root: string): Promise<CriticalPaths> {
  return readYaml(join(root, ".harnessme", "critical-paths.yaml"), CriticalPathsSchema);
}

/** Keep the maintainer's reason when a proposed gate is accepted or dismissed. */
export function recordCriticalReview(config: CriticalPaths, glob: string, decision: "activate" | "dismiss", reason: string): void {
  const explanation = reason.trim();
  if (explanation.length < 8) throw new Error("Critical-path review reason must explain the decision in at least 8 characters.");
  config.reviews = [...(config.reviews ?? []), { glob, decision, reason: explanation, reviewedAt: new Date().toISOString() }];
}

export function matchingCriticalPath(config: CriticalPaths, path: string) {
  const normalized = posixPath(path).replace(/^\.\//u, "");
  return config.paths.find((entry) => entry.status === "active" && minimatch(normalized, entry.glob, { dot: true, matchBase: false }));
}

export function findCriticalMatches(config: CriticalPaths, paths: string[]): CriticalMatch[] {
  const matches: CriticalMatch[] = [];
  for (const path of paths.map((item) => posixPath(item).replace(/^\.\//u, ""))) {
    const rule = matchingCriticalPath(config, path);
    if (rule) matches.push({ path, reason: rule.reason, approvers: rule.approvers });
  }
  return matches;
}

async function diffPaths(root: string, args: string[], description: string): Promise<string[]> {
  const output = await gitText(root, args, description);
  return output.split("\0").filter(Boolean).map(posixPath);
}

export async function stagedPaths(root: string): Promise<string[]> {
  return diffPaths(
    root,
    ["diff", "--cached", "--name-only", "-z", "--no-renames"],
    "Could not inspect staged files",
  );
}

export async function changedPathsSince(root: string, base: string): Promise<string[]> {
  return diffPaths(
    root,
    ["diff", "--name-only", "-z", "--no-renames", `${base}...HEAD`],
    `Could not compare against ${base}`,
  );
}

async function contentChangeId(root: string, object: string): Promise<string> {
  const result = await runGitBytes(root, ["show", object]);
  if (result.code !== 0) return "deleted";
  return createHash("sha256").update(result.stdout).digest("hex");
}

export function stagedChangeId(root: string, path: string): Promise<string> {
  return contentChangeId(root, `:${path}`);
}

export function headChangeId(root: string, path: string): Promise<string> {
  return contentChangeId(root, `HEAD:${path}`);
}

function parseCriticalRecord(file: string, content: string): CriticalRecord {
  const document = matter(content);
  const parsed = CriticalRecordDataSchema.safeParse(document.data);
  if (!parsed.success) throw new Error(`Invalid critical record ${file}: ${parsed.error.message}`);
  const normalizedPath = posixPath(parsed.data.path).replace(/^\.\//u, "");
  if (!normalizedPath || normalizedPath === ".." || normalizedPath.startsWith("../") || normalizedPath.startsWith("/")) {
    throw new Error(`Invalid critical record ${file}: path must stay inside the repository`);
  }
  if (parsed.data.status === "approved" && (!parsed.data["approved-by"] || !parsed.data.approvers.includes(parsed.data["approved-by"]))) {
    throw new Error(`Invalid critical record ${file}: approved-by must name a listed approver`);
  }
  return {
    file,
    status: parsed.data.status,
    path: normalizedPath,
    date: parsed.data.date,
    approvers: parsed.data.approvers,
    changeId: parsed.data["change-id"],
    summary: parsed.data.summary,
    approvedBy: parsed.data["approved-by"],
  };
}

export async function readCriticalRecords(root: string): Promise<CriticalRecord[]> {
  const directory = join(root, ".harnessme", "critical-log");
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
  } catch {
    return [];
  }
  return Promise.all(files.map(async (file) => parseCriticalRecord(file, await readText(join(directory, file)))));
}

async function gitVersion(root: string, path: string, source: "staged" | "head"): Promise<string | undefined> {
  const result = await runGit(root, ["show", source === "head" ? `HEAD:${path}` : `:${path}`]);
  return result.code === 0 ? result.stdout : undefined;
}

async function commitCriticalPaths(root: string, request: Extract<CriticalGateRequest, { phase: "commit" }>): Promise<CriticalPaths> {
  const registryPath = ".harnessme/critical-paths.yaml";
  const currentText = await gitVersion(root, registryPath, request.source);
  const current = currentText ? CriticalPathsSchema.parse(yaml.load(currentText)) : await readCriticalPaths(root);
  let baseline = "HEAD";
  if (request.source === "head" && request.base) {
    const mergeBase = await runGit(root, ["merge-base", request.base, "HEAD"]);
    if (mergeBase.code !== 0) throw new Error(`Could not find the merge base for ${request.base}: ${mergeBase.stderr.trim()}`);
    baseline = mergeBase.stdout.trim();
  }
  const prior = await runGit(root, ["show", `${baseline}:${registryPath}`]);
  if (prior.code !== 0) return current;
  const baselineConfig = CriticalPathsSchema.parse(yaml.load(prior.stdout));
  const active = new Map(current.paths.filter((entry) => entry.status === "active").map((entry) => [entry.glob, entry]));
  // A gate that existed before this change still governs code changed in it.
  for (const entry of baselineConfig.paths.filter((item) => item.status === "active")) active.set(entry.glob, entry);
  return { ...current, paths: [...active.values()] };
}

async function includedCriticalRecords(root: string, paths: Set<string>, source: "staged" | "head"): Promise<CriticalRecord[]> {
  const records: CriticalRecord[] = [];
  for (const path of [...paths].filter((path) => /^\.harnessme\/critical-log\/[^/]+\.md$/u.test(path)).sort()) {
    const content = await gitVersion(root, path, source);
    if (content !== undefined) records.push(parseCriticalRecord(basename(path), content));
  }
  return records;
}

function manifestContainsApproval(content: string | undefined, record: CriticalRecord, config: CriticalPaths, path: string): boolean {
  if (!content) return false;
  try {
    const manifest = JSON.parse(content) as { records?: CriticalRecord[]; paths?: CriticalPaths["paths"] };
    const rule = matchingCriticalPath(config, path);
    return Boolean(rule && manifest.paths?.some((item) => item.glob === rule.glob && item.status === "active")
      && manifest.records?.some((item) => item.file === record.file && item.status === "approved"
        && item.path === record.path && item.changeId === record.changeId && item.approvedBy === record.approvedBy));
  } catch {
    return false;
  }
}

/** Write the machine-readable counterpart to CRITICAL.md after each governance change. */
export async function writeCriticalManifest(root: string, config: CriticalPaths): Promise<void> {
  await writeJson(join(root, ".harnessme", "critical.json"), {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rollback: {
      recordRequired: true,
      steps: criticalRollbackSteps,
    },
    paths: config.paths,
    records: await readCriticalRecords(root),
  });
}

async function missingDirectiveMatches(root: string, config: CriticalPaths, paths: string[], request: CriticalGateRequest): Promise<CriticalMatch[]> {
  const candidates = paths.filter((path) => path.endsWith(".py") && !isTestPath(path)
    && !path.startsWith("/") && !path.split("/").includes("..") && !matchingCriticalPath(config, path));
  if (!candidates.length) return [];
  const directives = await readText(join(root, ".harnessme", "facts", "directives.md"));
  const methods = protectedMethodsFromDirectives(directives);
  if (!methods.length) return [];
  const matches: CriticalMatch[] = [];
  for (const path of candidates) {
    let source = "";
    if (request.phase === "commit") {
      const object = request.source === "head" ? `HEAD:${path}` : `:${path}`;
      const staged = await runGit(root, ["show", object]);
      if (staged.code === 0) source = staged.stdout;
    }
    if (!source) {
      try { source = await readText(join(root, path)); } catch { /* deleted file */ }
    }
    let defined = protectedMethodsDefinedInPython(path, source, methods);
    if (!defined.length && request.phase === "commit") {
      const previous = await runGit(root, ["show", `HEAD:${path}`]);
      if (previous.code === 0) defined = protectedMethodsDefinedInPython(path, previous.stdout, methods);
    }
    if (defined.length) matches.push({
      path,
      reason: `Imported maintainer directives protect ${defined.join(", ")}, but its active gate is missing; run harnessme refresh.`,
      approvers: ["developer"],
    });
  }
  return matches;
}

export async function evaluateCriticalGate(root: string, request: CriticalGateRequest): Promise<CriticalGateResult> {
  const config = request.phase === "commit" ? await commitCriticalPaths(root, request) : await readCriticalPaths(root);
  const checkedPaths = [...new Set(request.paths.map((path) => repositoryRelativePath(root, path)))];
  const missing = await missingDirectiveMatches(root, config, checkedPaths, request);
  const missingPaths = new Set(missing.map((item) => item.path));
  const critical = [...findCriticalMatches(config, checkedPaths), ...missing];
  if (request.phase === "edit") {
    return {
      checkedPaths,
      critical,
      failures: critical.map((match) => ({
        path: match.path,
        code: missingPaths.has(match.path) ? "missing-gate" : "confirmation-required",
        reason: missingPaths.has(match.path)
          ? match.reason
          : `developer confirmation required before editing this critical path (${match.reason})`,
      })),
    };
  }

  const included = new Set(request.includedPaths.map((path) => repositoryRelativePath(root, path)));
  const records = await includedCriticalRecords(root, included, request.source);
  const indexPath = ".harnessme/CRITICAL.md";
  const manifestPath = ".harnessme/critical.json";
  const [index, manifest] = await Promise.all([
    gitVersion(root, indexPath, request.source),
    gitVersion(root, manifestPath, request.source),
  ]);
  const failures: GateFailure[] = [];
  for (const match of critical) {
    if (missingPaths.has(match.path)) {
      failures.push({ path: match.path, code: "missing-gate", reason: match.reason });
      continue;
    }
    const changeId = request.source === "head"
      ? await headChangeId(root, match.path)
      : await stagedChangeId(root, match.path);
    const record = records.find((candidate) =>
      candidate.path === match.path
      && candidate.status === "approved"
      && candidate.changeId === changeId
      && match.approvers.some((approver) => approver.replace(/^@/u, "") === candidate.approvedBy?.replace(/^@/u, ""))
    );
    if (!record) {
      failures.push({
        path: match.path,
        code: "approval-required",
        reason: `approved critical record required for change-id ${changeId} (${match.reason})`,
      });
      continue;
    }
    const recordPath = `.harnessme/critical-log/${record.file}`;
    if (!included.has(recordPath)) {
      failures.push({ path: match.path, code: "record-not-in-change", reason: `${recordPath} must be included with the code change` });
    }
    const escapedSummary = record.summary.replaceAll("|", "\\|");
    const indexed = (index ?? "").split(/\r?\n/u).some((line) =>
      line.includes(`| ${record.path} | ${escapedSummary} |`)
      && line.includes(`| @${record.approvedBy} |`)
      && line.includes(`| ${record.changeId} |`),
    );
    if (!included.has(indexPath) || !indexed) {
      failures.push({ path: match.path, code: "index-not-in-change", reason: `${indexPath} must include this approved change` });
    }
    if (!included.has(manifestPath) || !manifestContainsApproval(manifest, record, config, match.path)) {
      failures.push({ path: match.path, code: "manifest-not-in-change", reason: `${manifestPath} must include this approved change and active gate` });
    }
  }
  return { checkedPaths, critical, failures };
}
