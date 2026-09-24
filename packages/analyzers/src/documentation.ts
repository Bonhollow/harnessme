import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
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
  const cleaned = reference.replace(/^\.\//u, "")
    .replace(/(?::\d+|#[A-Za-z0-9_-]+)$/u, "")
    .replace(/::[A-Za-z_][A-Za-z0-9_.]*$/u, "");
  if (/(?:^|\/)\.env(?:\.[^/]+)?\.local$/u.test(cleaned)) return undefined;
  if (!cleaned.includes("/") || /\s|:\/\//u.test(cleaned) || cleaned.startsWith("/")) return undefined;
  const root = cleaned.split("/", 1)[0];
  if (!root || !roots.has(root) || cleaned.includes("..") || /[*{}$]/u.test(cleaned)) return undefined;
  return posixPath(cleaned);
}

export async function analyzeDocumentation(
  root: string,
  exclude: string[],
): Promise<{ paths: string[]; conflicts: DocumentationConflict[]; links: Array<{ document: string; path: string; line: number }> }> {
  const paths = (await fg(["README.md", "CONTRIBUTING.md", "**/docs/**/*.md", ".agents/**/agent.md", ".agents/**/references/**/*.md"], {
    cwd: root,
    onlyFiles: true,
    unique: true,
    dot: true,
    ignore: exclude,
    followSymbolicLinks: false,
  })).map(posixPath).filter((path) => basename(path).toLowerCase() !== "agents.md").sort();
  const topLevel = await fg("*", { cwd: root, onlyDirectories: true, unique: true, followSymbolicLinks: false });
  const roots = new Set(topLevel.map(posixPath));
  const conflicts: DocumentationConflict[] = [];
  const links: Array<{ document: string; path: string; line: number }> = [];
  for (const document of paths) {
    const content = await readable(join(root, document));
    if (!content) continue;
    const lines = content.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(referencePattern)) {
        const reference = match[1] ? repositoryPath(match[1], roots) : undefined;
        if (!reference) continue;
        if (await exists(join(root, reference))) {
          links.push({ document, path: reference, line: index + 1 });
          continue;
        }
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
  return { paths, conflicts, links };
}
