import { renderChangeContext, resolveChangeContext, type FactsSnapshot, type ReferenceDocument } from "../../../core/src/index.js";
import { concernReferenceDocuments, guidanceDirectory } from "./concerns.js";
import { referenceScopes, scopeMatchesPath } from "./scopes.js";

export interface NestedAgentDocument { directory: string; markdown: string }

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const bodyStart = start + heading.length + 3;
  const next = markdown.slice(bodyStart).search(/^##\s+/mu);
  return markdown.slice(bodyStart, next < 0 ? undefined : bodyStart + next).trim();
}

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
  for (const scope of referenceScopes(reference)) {
    const scoped = referenceDirectory(scope);
    if (scoped) {
      const scopedDirectory = sourcePaths.has(scoped) ? guidanceDirectory(scoped) : scoped;
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
  const commands = facts.stack.validationCommands ?? [];
  const activeGates = facts.criticalPaths.paths.filter((entry) => entry.status === "active");
  return [...groups.entries()].map(([directory, documents]) => {
    const citedLocalPaths = documents.flatMap((document) =>
      [...document.markdown.matchAll(/`([^`]+)`/gu)]
        .map((match) => match[1])
        .filter((path): path is string => Boolean(path && (facts.stack.sourcePaths ?? []).includes(path) && path.startsWith(`${directory}/`))),
    );
    const localPaths = [...new Set([
      ...citedLocalPaths,
      ...(facts.stack.sourcePaths ?? []).filter((path) => path.startsWith(`${directory}/`)),
    ])].slice(0, 12);
    const localRules = documents.map((document) => {
      const responsibilities = section(document.markdown, "Responsibilities");
      const extensionSeams = section(document.markdown, "Extension seams");
      const invariants = section(document.markdown, "Invariants");
      const antiPatterns = section(document.markdown, "Anti-patterns");
      const body = [responsibilities, extensionSeams, invariants, antiPatterns].filter(Boolean).join("\n\n");
      return body ? `### ${document.title}\n\n${body}` : "";
    }).filter(Boolean).join("\n\n");
    const gates = activeGates.filter((entry) => scopeMatchesPath(`${directory}/**`, entry.glob.replace(/\*.*$/u, ""))
      || entry.glob.startsWith(`${directory}/`));
    const graphContext = facts.knowledgeGraph && localPaths.length
      ? renderChangeContext(resolveChangeContext(facts, localPaths), { compact: true, pathPrefix: "../".repeat(directory.split("/").length) })
      : "## Graph-routed context\n\n- No graph context is available; run `harnessme refresh` after structural changes.\n";
    return {
      directory,
      markdown: `# Scoped agent guidance

This file adds rules for \`${directory}/\`. Read the repository root \`AGENTS.md\` first.

## Applicable guides

${documents.map((document) => `- [${document.title}](${"../".repeat(directory.split("/").length)}.harnessme/references/${document.slug}.md): ${document.description}`).join("\n")}

${graphContext.trim()}

## Local ownership

Start from these detected owning paths before adding a new implementation seam:
${localPaths.length ? localPaths.map((path) => `- \`${path}\``).join("\n") : `- Inspect the nearest implementation and tests under \`${directory}/\`; do not create a parallel implementation.`}

## Local operating rules

${localRules || "- Preserve the local interface and update coupled consumers together.\n- Use the existing implementation seam; do not create a parallel path around it."}

## Change workflow

1. Read the applicable guide above, then trace the owning method or type, direct callers, focused tests, and task-relevant documentation.
2. Make the smallest change through the existing seam; update coupled consumers, registrations, and contracts in the same change.
3. Update the applicable reference document when this change establishes or changes a canonical local workflow, invariant, extension seam, or validation rule.
4. Run the relevant verified checks: ${commands.length ? commands.map((command) => `\`${command}\``).join(", ") : "inspect checked-in task configuration before choosing validation"}.

## Critical changes

${gates.length
  ? `Before editing any protected path below, stop and obtain explicit developer confirmation. After confirmation, create a critical record with \`harnessme critical draft <path> --summary "..."\`, then include impact, validation, and rollback notes in the approved record.\n\n${gates.map((entry) => `- \`${entry.glob}\` [${entry.risk ?? "other"}]: ${entry.reason}`).join("\n")}`
  : "If a task reaches a root-level critical path, stop for explicit developer confirmation. Record any confirmed invasive change with its behavior impact, validation, and rollback plan."}
`,
    };
  });
}
