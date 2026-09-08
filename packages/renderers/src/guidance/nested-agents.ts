import type { FactsSnapshot, ReferenceDocument } from "@harnessme/core";
import { concernReferenceDocuments, guidanceDirectory } from "./concerns.js";

export interface NestedAgentDocument { directory: string; markdown: string }

function referenceDirectory(scope: string): string | undefined {
  const directory = scope.replace(/\/\*\*.*$/u, "").replace(/\/$/u, "");
  return directory && !directory.includes("*") ? directory : undefined;
}

function referenceDirectories(facts: FactsSnapshot, reference: ReferenceDocument): string[] {
  const sourcePaths = new Set(facts.stack.sourcePaths ?? []);
  const citedPaths = [...reference.markdown.matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1]?.replace(/:\d+$/u, ""))
    .filter((path): path is string => Boolean(path && sourcePaths.has(path)));
  const directories = new Set(citedPaths.map(guidanceDirectory).filter((path): path is string => Boolean(path)));
  const scoped = referenceDirectory(reference.scope);
  if (scoped) {
    const scopedDirectory = sourcePaths.has(scoped) ? guidanceDirectory(scoped) : scoped;
    if (scopedDirectory) directories.add(scopedDirectory);
  }
  return [...directories].filter((directory, _index, all) =>
    !all.some((parent) => parent !== directory && directory.startsWith(`${parent}/`)));
}

export function nestedAgentDocuments(
  facts: FactsSnapshot,
  references: ReferenceDocument[] = concernReferenceDocuments(facts),
): NestedAgentDocument[] {
  const groups = new Map<string, ReferenceDocument[]>();
  for (const reference of references) {
    for (const directory of referenceDirectories(facts, reference)) {
      groups.set(directory, [...(groups.get(directory) ?? []), reference]);
    }
  }
  return [...groups.entries()].map(([directory, documents]) => ({
    directory,
    markdown: `# Scoped agent guidance

This file adds rules for \`${directory}/\`. Read the repository root \`AGENTS.md\` first.

## Applicable guides

${documents.map((document) => `- [${document.title}](${"../".repeat(directory.split("/").length)}.harnessme/references/${document.slug}.md): ${document.description}`).join("\n")}

## Before editing

- Identify the owning method or type, its callers, focused tests, and applicable guide.
- Preserve the local interface and update coupled consumers together.
- If the root harness marks the path critical, stop and obtain explicit developer confirmation before editing.
`,
  }));
}
