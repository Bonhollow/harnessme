import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { minimatch } from "minimatch";
import { z } from "zod";
import { gitText, runGit } from "./git.js";
import { CriticalPathsSchema, type CriticalPaths } from "./schema.js";
import { posixPath, readText, readYaml } from "./files.js";

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
  code: "confirmation-required" | "approval-required" | "record-not-in-change" | "index-not-in-change";
}

export type CriticalGateRequest =
  | { phase: "edit"; paths: string[] }
  | { phase: "commit"; paths: string[]; includedPaths: string[]; source: "staged" | "head" };

export interface CriticalGateResult {
  checkedPaths: string[];
  critical: CriticalMatch[];
  failures: GateFailure[];
}

export async function readCriticalPaths(root: string): Promise<CriticalPaths> {
  return readYaml(join(root, ".harnessme", "critical-paths.yaml"), CriticalPathsSchema);
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
  return output.split(/\r?\n/u).map((path) => posixPath(path.trim())).filter(Boolean);
}

export async function stagedPaths(root: string): Promise<string[]> {
  return diffPaths(
    root,
    ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=ACMD"],
    "Could not inspect staged files",
  );
}

export async function changedPathsSince(root: string, base: string): Promise<string[]> {
  return diffPaths(
    root,
    ["diff", "--name-only", "--no-renames", "--diff-filter=ACMD", `${base}...HEAD`],
    `Could not compare against ${base}`,
  );
}

async function contentChangeId(root: string, object: string): Promise<string> {
  const result = await runGit(root, ["show", object]);
  if (result.code !== 0) return "deleted";
  return createHash("sha256").update(result.stdout, "utf8").digest("hex");
}

export function stagedChangeId(root: string, path: string): Promise<string> {
  return contentChangeId(root, `:${path}`);
}

export function headChangeId(root: string, path: string): Promise<string> {
  return contentChangeId(root, `HEAD:${path}`);
}

export async function readCriticalRecords(root: string): Promise<CriticalRecord[]> {
  const directory = join(root, ".harnessme", "critical-log");
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const records: CriticalRecord[] = [];
  for (const file of files) {
    const document = matter(await readText(join(directory, file)));
    const parsed = CriticalRecordDataSchema.safeParse(document.data);
    if (!parsed.success) throw new Error(`Invalid critical record ${file}: ${parsed.error.message}`);
    const normalizedPath = posixPath(parsed.data.path).replace(/^\.\//u, "");
    if (!normalizedPath || normalizedPath === ".." || normalizedPath.startsWith("../") || normalizedPath.startsWith("/")) {
      throw new Error(`Invalid critical record ${file}: path must stay inside the repository`);
    }
    if (parsed.data.status === "approved" && (!parsed.data["approved-by"] || !parsed.data.approvers.includes(parsed.data["approved-by"]))) {
      throw new Error(`Invalid critical record ${file}: approved-by must name a listed approver`);
    }
    records.push({
      file,
      status: parsed.data.status,
      path: normalizedPath,
      date: parsed.data.date,
      approvers: parsed.data.approvers,
      changeId: parsed.data["change-id"],
      summary: parsed.data.summary,
      approvedBy: parsed.data["approved-by"],
    });
  }
  return records;
}

export async function evaluateCriticalGate(root: string, request: CriticalGateRequest): Promise<CriticalGateResult> {
  const config = await readCriticalPaths(root);
  const checkedPaths = [...new Set(request.paths.map((path) => posixPath(path).replace(/^\.\//u, "")))];
  const critical = findCriticalMatches(config, checkedPaths);
  if (request.phase === "edit") {
    return {
      checkedPaths,
      critical,
      failures: critical.map((match) => ({
        path: match.path,
        code: "confirmation-required",
        reason: `developer confirmation required before editing this critical path (${match.reason})`,
      })),
    };
  }

  const records = await readCriticalRecords(root);
  const included = new Set(request.includedPaths.map((path) => posixPath(path)));
  const indexPath = ".harnessme/CRITICAL.md";
  const index = await readText(join(root, indexPath));
  const failures: GateFailure[] = [];
  for (const match of critical) {
    const changeId = request.source === "head"
      ? await headChangeId(root, match.path)
      : await stagedChangeId(root, match.path);
    const record = records.find((candidate) =>
      candidate.path === match.path
      && candidate.status === "approved"
      && candidate.changeId === changeId
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
    const indexed = index.split(/\r?\n/u).some((line) =>
      line.includes(`| ${record.path} | ${escapedSummary} |`) && line.includes(`| ${record.changeId} |`),
    );
    if (!included.has(indexPath) || !indexed) {
      failures.push({ path: match.path, code: "index-not-in-change", reason: `${indexPath} must include this approved change` });
    }
  }
  return { checkedPaths, critical, failures };
}
