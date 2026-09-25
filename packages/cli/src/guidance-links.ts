import { resolve, dirname, isAbsolute, relative } from "node:path";
import { access, readFile } from "node:fs/promises";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export interface GuidanceLinkIssue { source: string; target: string }

export function markdownLinkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1]?.trim().split("#", 1)[0])
    .filter((target): target is string => Boolean(target && !target.startsWith("#") && !/^[a-z][a-z\d+.-]*:/iu.test(target) && !target.startsWith("//")));
}

export async function auditGuidanceLinks(root: string, paths: string[]): Promise<GuidanceLinkIssue[]> {
  const issues: GuidanceLinkIssue[] = [];
  const rootPath = resolve(root);
  for (const source of [...new Set(paths)]) {
    const sourcePath = resolve(rootPath, source);
    if (!await exists(sourcePath)) continue;
    const markdown = await readFile(sourcePath, "utf8");
    for (const target of markdownLinkTargets(markdown)) {
      const destination = resolve(dirname(sourcePath), target);
      if (isAbsolute(target) || relative(rootPath, destination).startsWith("..") || !await exists(destination)) {
        issues.push({ source, target });
      }
    }
  }
  return issues;
}
