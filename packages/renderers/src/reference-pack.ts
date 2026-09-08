import type { FactsSnapshot, ReferenceDocument } from "@harnessme/core";
import { concernReferenceDocuments } from "./guidance/concerns.js";

function titleFor(scope: string): string {
  return scope.split(/[\/_-]/u).filter(Boolean).map((part) => ["api", "ui", "db", "mcp"].includes(part.toLowerCase())
    ? part.toUpperCase()
    : `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function operationalStatement(statement: string, category: string): string {
  const instruction = statement.includes(";") ? statement.slice(statement.indexOf(";") + 1).trim() : statement;
  if (!/\b(?:detected|present|contains)\b|\b\d+\s+of\s+\d+\b/iu.test(instruction)) return instruction;
  if (category === "error-handling") return "Preserve the established error propagation and handling pattern.";
  if (category === "oop") return "Preserve established base-class, repository, factory, and object-lifecycle contracts.";
  if (category === "testing") return "Update nearby tests when changing behavior.";
  return "Preserve the established local contract.";
}

export function referenceDocuments(facts: FactsSnapshot): ReferenceDocument[] {
  if (facts.referencePack?.documents.length) return facts.referencePack.documents;
  const concerns = concernReferenceDocuments(facts);
  if (concerns.length) return concerns;
  const evidence = new Map(facts.evidence.map((item) => [item.id, item]));
  const moduleFacts = new Map(facts.stack.topLevelModules.map((module) => [module, facts.conventions.facts.filter((fact) =>
    fact.evidence.some((id) => evidence.get(id)?.path.startsWith(`${module}/`))
  )]));
  const modules = [...moduleFacts.entries()].filter(([, moduleRules]) => moduleRules.length).map(([module]) => module).slice(0, 12);
  const scopes = modules.length ? modules : ["repository"];
  return scopes.map((scope) => {
    const slug = scope === "repository" ? "repository-workflow" : `${scope.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase()}-workflow`;
    const path = scope === "repository" ? "the repository" : `\`${scope}/\``;
    const scopedCommands = (facts.stack.validationCommands ?? []).filter((command) => scope === "repository"
      || command.includes(scope)
      || !facts.stack.topLevelModules.some((module) => command.includes(module)));
    const commands = scopedCommands.length
      ? scopedCommands.map((command) => `- \`${command}\``).join("\n")
      : "- Run the nearest verified repository check; do not invent a command.";
    const rules = scope === "repository" ? facts.conventions.facts : moduleFacts.get(scope) ?? [];
    const groundedRules = rules.length
      ? rules.map((fact) => {
        const citations = fact.evidence.flatMap((id) => {
          const item = evidence.get(id);
          return item ? [`\`${item.path}:${item.line}\``] : [];
        }).join(", ");
        const statement = operationalStatement(fact.statement, fact.category);
        return `- ${statement.charAt(0).toUpperCase()}${statement.slice(1)} Evidence: ${citations}.`;
      }).join("\n")
      : "- Preserve the nearest established public contracts and local error behavior.";
    return {
      slug,
      title: `${titleFor(scope)} change guide`,
      scope: scope === "repository" ? "**/*" : `${scope}/**`,
      description: `Operational guidance for changes in ${path}.`,
      markdown: `# ${titleFor(scope)} change guide

## Scope

Use this guide for changes in ${path}.

## Responsibilities

- Identify the owning implementation and its public callers before editing.
- Keep behavior inside the existing module seam unless repository evidence requires a coordinated change.

## Invariants

${groundedRules}
- Treat cross-module effects as compatibility work and update affected consumers together.

## Change workflow

1. Inspect the implementation, callers, tests, and task-relevant documentation.
2. Make the smallest change through the established seam.
3. Update affected tests and documentation in the same change.
4. Run the verified checks below.

## Validation

${commands}
`,
    };
  });
}

export function renderReferenceMap(facts: FactsSnapshot): string {
  return referenceDocuments(facts)
    .map((document) => `- [${document.title}](.harnessme/references/${document.slug}.md): ${document.description}`)
    .join("\n");
}
