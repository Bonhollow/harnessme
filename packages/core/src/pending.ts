import { basename, join } from "node:path";
import fg from "fast-glob";
import { exists, posixPath, readText } from "./files.js";
import { tryGitText } from "./git.js";

const bulletPattern = /^\s*-\s+(\d{4}-\d{2}-\d{2}):\s+(.+?)\s*$/u;
const pathPattern = /(?:`([^`]+)`|\b((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+))/gu;

export interface PendingValidation {
  original: string;
  status: "verified" | "needs-review" | "ignored";
  resolvedPaths: string[];
  reason?: string;
  date?: string;
  summary?: string;
}

function referencedPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(pathPattern)) {
    const path = (match[1] ?? match[2])?.trim();
    if (path && !path.includes(" ")) paths.push(posixPath(path.replace(/^\.\//u, "")));
  }
  return [...new Set(paths)];
}

export async function validatePendingLine(
  root: string,
  line: string,
  maxRetries: number,
): Promise<PendingValidation> {
  const parsed = line.match(bulletPattern);
  if (!parsed) return { original: line, status: "ignored", resolvedPaths: [] };
  const description = parsed[2] ?? "";
  const date = parsed[1];
  const paths = referencedPaths(description);
  if (!paths.length) {
    return { original: line, status: "needs-review", resolvedPaths: [], reason: "no repository path cited", date, summary: description };
  }
  const resolved: string[] = [];
  for (const path of paths) {
    if (await exists(join(root, path))) {
      resolved.push(path);
      continue;
    }
    const deleted = await tryGitText(root, ["diff", "--name-only", "--diff-filter=D", "HEAD", "--", path]);
    if (deleted?.split(/\r?\n/u).map(posixPath).includes(path)) {
      resolved.push(path);
      continue;
    }
    if (maxRetries > 0) {
      const matches = await fg(`**/${basename(path)}`, {
        cwd: root,
        onlyFiles: true,
        ignore: ["**/.git/**", "**/node_modules/**", "**/.harnessme/**"],
      });
      if (matches.length === 1) {
        resolved.push(posixPath(matches[0]!));
        continue;
      }
    }
    if (maxRetries > 1) {
      const stem = basename(path).replace(/\.[^.]+$/u, "").toLowerCase();
      const matches = (await fg("**/*", {
        cwd: root,
        onlyFiles: true,
        ignore: ["**/.git/**", "**/node_modules/**", "**/.harnessme/**"],
      })).filter((candidate) => basename(candidate).toLowerCase().includes(stem));
      if (matches.length === 1) resolved.push(posixPath(matches[0]!));
    }
  }
  if (resolved.length !== paths.length) {
    return {
      original: line,
      status: "needs-review",
      resolvedPaths: resolved,
      reason: "one or more cited paths do not exist or are ambiguous",
      date,
      summary: description,
    };
  }
  const pathText = new Set(paths.flatMap((path) => posixPath(path).toLowerCase().split(/[^a-z0-9]+/u)));
  const stop = new Set(["added", "changed", "updated", "implemented", "removed", "fixed", "support", "feature", "code", "file", "files", "with", "from", "into", "the", "and", "for", "this", "that"]);
  const claimTokens = description.toLowerCase().split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 4 && !stop.has(token) && !pathText.has(token));
  if (claimTokens.length) {
    const evidenceText: string[] = [];
    for (const path of resolved) {
      if (await exists(join(root, path))) evidenceText.push(await readText(join(root, path)));
      evidenceText.push(await tryGitText(root, ["diff", "HEAD", "--", path]) ?? "");
    }
    const normalized = evidenceText.join("\n").toLowerCase().replace(/[^a-z0-9]+/gu, " ");
    const matched = claimTokens.filter((token) => normalized.includes(token));
    if (!matched.length) {
      return { original: line, status: "needs-review", resolvedPaths: resolved, reason: "claim terms were not found in the cited code or diff", date, summary: description };
    }
  }
  return { original: line, status: "verified", resolvedPaths: resolved, date, summary: description };
}
