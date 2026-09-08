import type { Evidence, FactsSnapshot, ReferenceDocument } from "@harnessme/core";

export interface GuidanceConcern {
  slug: string;
  title: string;
  scope: string;
  directory: string;
  description: string;
  paths: string[];
  evidence: Evidence[];
}

const DEFINITIONS = [
  { slug: "authentication", title: "Authentication and security", pattern: /(?:auth|security|token|session|permission)/iu },
  { slug: "persistence", title: "Persistence and idempotency", pattern: /(?:repository|store|database|\/db\.|models?|migration|idempoten)/iu },
  { slug: "experiment-lifecycle", title: "Experiment lifecycle", pattern: /(?:experiment|completion_policy|retry)/iu },
  { slug: "dataset-sync", title: "Dataset synchronization", pattern: /(?:dataset|tool_definitions)/iu },
  { slug: "evaluation", title: "Evaluation execution", pattern: /(?:\/evals?\/|\/metrics?\/|graph_eval|experiment_runner)/iu },
  { slug: "ui-contract", title: "UI and server contract", pattern: /(?:coreval-ui\/src\/api|schema\.d\.ts|client\.ts)/iu },
] as const;

export function guidanceDirectory(path: string): string | undefined {
  const parts = path.split("/");
  if (parts.length < 2) return undefined;
  if (parts[0] === "src" && parts.length > 3) return parts.slice(0, 3).join("/");
  if (parts[1] === "src" && parts.length > 2) return parts.slice(0, 2).join("/");
  return parts.slice(0, Math.min(2, Math.max(1, parts.length - 1))).join("/");
}

export function discoverGuidanceConcerns(facts: FactsSnapshot): GuidanceConcern[] {
  return DEFINITIONS.flatMap((definition) => {
    const sourceMatches = (facts.stack.sourcePaths ?? []).filter((path) =>
      !/(?:^|\/)tests?(?:\/|$)/iu.test(path) && definition.pattern.test(path));
    const evidenceMatches = facts.evidence
      .filter((item) => definition.pattern.test(item.path) || definition.pattern.test(item.excerpt))
      .map((item) => item.path);
    const paths = [...new Set(sourceMatches.length ? sourceMatches : evidenceMatches)];
    if (!paths.length) return [];
    const grouped = new Map<string, string[]>();
    for (const path of paths) {
      const directory = guidanceDirectory(path);
      if (!directory) continue;
      grouped.set(directory, [...(grouped.get(directory) ?? []), path]);
    }
    return [...grouped.entries()].map(([directory, scopedPaths]) => ({
      ...definition,
      slug: grouped.size === 1 ? definition.slug : `${definition.slug}-${directory.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}`,
      scope: `${directory}/**`,
      directory,
      description: `Read before changing ${definition.title.toLowerCase()} behavior under \`${directory}/\`.`,
      paths: scopedPaths.sort(),
      evidence: facts.evidence.filter((item) =>
        (scopedPaths.includes(item.path) || item.path.startsWith(`${directory}/`))
        && (definition.pattern.test(item.path) || definition.pattern.test(item.excerpt))).slice(0, 8),
    }));
  }).filter((item, index, items) => items.findIndex((candidate) => candidate.slug === item.slug) === index);
}

export function concernReferenceDocuments(facts: FactsSnapshot): ReferenceDocument[] {
  const commands = facts.stack.validationCommands ?? [];
  return discoverGuidanceConcerns(facts).slice(0, 20).map((concern) => {
    const citations = concern.evidence.map((item) => `- Preserve the observed contract at \`${item.path}:${item.line}\`: ${item.excerpt}`).join("\n");
    const ownership = concern.paths.slice(0, 12).map((path) => `- \`${path}\``).join("\n");
    const validation = commands.length ? commands.map((command) => `- \`${command}\``).join("\n") : "- Run the nearest verified repository check.";
    return {
      slug: concern.slug,
      title: concern.title,
      scope: concern.scope,
      description: concern.description,
      markdown: `# ${concern.title}

## Scope

Use this guide for changes in \`${concern.scope}\`.

## Responsibilities

- Keep changes through the existing implementation and interfaces under \`${concern.directory}/\`.
- Inspect callers, consumers, and focused tests before editing.

## Ownership map

Start investigation with these detected implementation paths:

${ownership}

## Invariants

${citations || "- No semantic invariant was verified deterministically; inspect the ownership map and nearby tests before changing behavior."}
- Preserve public behavior and update coupled consumers together.

## Anti-patterns

- Do not create a parallel implementation that bypasses the observed owning seam.
- Do not change persisted, security, or public contracts without compatibility analysis and focused tests.

## Change workflow

1. Start from the ownership map, identify the owning method or type, and trace direct callers.
2. Inspect the nearest tests and task-relevant documentation.
3. Change the owning implementation and coupled consumers together.
4. Run the verified checks below.

## Validation

${validation}
`,
    };
  });
}
