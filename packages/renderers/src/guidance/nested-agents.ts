import type { FactsSnapshot, ReferenceDocument } from "../../../core/src/index.js";
import { concernReferenceDocuments, guidanceDirectory } from "./concerns.js";
import { referenceScopes } from "./scopes.js";

export interface NestedAgentDocument { directory: string; markdown: string }

function referenceDirectory(scope: string): string | undefined {
  const directory = scope.replace(/\/\*\*.*$/u, "").replace(/\/$/u, "");
  return directory && !directory.includes("*") ? directory : undefined;
}

function referenceDirectories(facts: FactsSnapshot, reference: ReferenceDocument): string[] {
  const sourcePaths = new Set([...(facts.stack.sourcePaths ?? []), ...(facts.structure?.scopePaths ?? [])]);
  const documentationPaths = new Set(facts.stack.documentationPaths ?? []);
  const citedPaths = [...reference.markdown.matchAll(/`([^`]+)`/gu)]
    .map((match) => match[1]?.replace(/:\d+$/u, ""))
    .filter((path): path is string => Boolean(path && sourcePaths.has(path)));
  const directories = new Set(citedPaths.map(guidanceDirectory).filter((path): path is string => Boolean(path)));
  for (const scope of referenceScopes(reference)) {
    const scoped = referenceDirectory(scope);
    if (scoped) {
      const scopedDirectory = sourcePaths.has(scoped)
        ? guidanceDirectory(scoped)
      : documentationPaths.has(scoped) ? (scoped.includes("/") ? scoped.slice(0, scoped.lastIndexOf("/")) : undefined) : scoped;
      if (scopedDirectory) directories.add(scopedDirectory);
    }
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
  const activeGates = facts.criticalPaths.paths.filter((entry) => entry.status === "active");
  return [...groups.entries()].map(([directory, documents]) => {
    const prefix = "../".repeat(directory.split("/").length);
    const gates = activeGates.filter((entry) => entry.glob.startsWith(`${directory}/`));
    return {
      directory,
      markdown: `# Scoped agent guidance

This file applies to \`${directory}/\`. Read the repository root \`AGENTS.md\` and its project directives first.

## Applicable guides

${documents.map((document) => `- [${document.title}](${prefix}.harnessme/references/${document.slug}.md): ${document.description}`).join("\n")}

## Change workflow

1. Read the task-relevant guide above. Use \`harnessme context <path>\` to find the owner, dependencies, and focused tests for a changed file.
2. Inspect the implementation and callers, then change behavior through its existing extension seam. Update coupled consumers and tests.
3. Update the relevant guide when a canonical local workflow, invariant, or extension seam changes. Run focused tests and the verified commands in the root guide.

## Critical changes

${gates.length
  ? `These active gates require explicit developer confirmation before editing. After confirmation, follow [the critical change audit](${prefix}.harnessme/agent-pack/critical-change-audit.md), including the approved record, impact, validation, and rollback notes.\n\n${gates.map((entry) => `- \`${entry.glob}\` [${entry.risk ?? "other"}]: ${entry.reason}`).join("\n")}`
  : "Root-level critical paths still require explicit developer confirmation before editing. Follow the root contract and critical change audit."}
`,
    };
  });
}
