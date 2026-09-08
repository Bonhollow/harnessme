import { stat } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";
import type { DocumentationConflict } from "@harnessme/core";
import { posixPath } from "../../core/src/files.js";
import { readable } from "./evidence.js";

const referencePattern = /`([^`\n]+)`/gu;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function repositoryPath(reference: string, roots: Set<string>): string | undefined {
  const cleaned = reference.replace(/^\.\//u, "").replace(/(?::\d+|#[A-Za-z0-9_-]+)$/u, "");
  if (!cleaned.includes("/") || /\s|:\/\//u.test(cleaned) || cleaned.startsWith("/")) return undefined;
  const root = cleaned.split("/", 1)[0];
  if (!root || !roots.has(root) || cleaned.includes("..") || /[*{}$]/u.test(cleaned)) return undefined;
  return posixPath(cleaned);
}

export async function analyzeDocumentation(
  root: string,
  exclude: string[],
): Promise<{ paths: string[]; conflicts: DocumentationConflict[] }> {
  const paths = (await fg(["README.md", "CONTRIBUTING.md", "docs/**/*.md"], {
    cwd: root,
    onlyFiles: true,
    unique: true,
    ignore: exclude,
    followSymbolicLinks: false,
  })).map(posixPath).sort();
  const topLevel = await fg("*", { cwd: root, onlyDirectories: true, unique: true, followSymbolicLinks: false });
  const roots = new Set(topLevel.map(posixPath));
  const conflicts: DocumentationConflict[] = [];
  for (const document of paths) {
    const content = await readable(join(root, document));
    if (!content) continue;
    const lines = content.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(referencePattern)) {
        const reference = match[1] ? repositoryPath(match[1], roots) : undefined;
        if (!reference || await exists(join(root, reference))) continue;
        conflicts.push({
          kind: "missing-path",
          document,
          line: index + 1,
          reference,
          message: `Documentation references a repository path that does not exist: ${reference}`,
        });
      }
    }
  }
  return { paths, conflicts };
}
