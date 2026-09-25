import type { FactsSnapshot, ReferenceDocument } from "@harnessme/core";
import { isTestPath } from "../../../core/src/risk.js";
import { protectedMethodsFromDirectives } from "../../../core/src/directives.js";
import { GENERATED_MARKER, renderAgentsMd } from "../agents-md.js";
import { referenceScopes } from "./scopes.js";

export interface AgentPackDocument {
  path: string;
  markdown: string;
}

function moduleMap(facts: FactsSnapshot): string {
  return facts.stack.topLevelModules.length
    ? facts.stack.topLevelModules.map((module) => `- \`${module}/\`: inspect its local instructions, owning paths, callers, and tests before changing a cross-module contract.`).join("\n")
    : "- No stable top-level modules were detected; start with the nearest implementation, caller, and test.";
}

function priorityRules(facts: FactsSnapshot, references: ReferenceDocument[]): string {
  const knownPaths = new Set([...(facts.stack.sourcePaths ?? []), ...(facts.stack.documentationPaths ?? []), ...(facts.structure?.scopePaths ?? [])]);
  const ranked = references.flatMap((reference, index) => {
    const sections = ["Invariants", "Anti-patterns"].flatMap((heading) => {
      const body = reference.markdown.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "mu"))?.[1] ?? "";
      return body.split("\n").filter((line) => /^[-*] /u.test(line));
    });
    const grounded = sections.find((line) => {
      const paths = [...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1]?.replace(/:\d+(?:-\d+)?$/u, ""));
      return paths.some((path) => path && knownPaths.has(path));
    });
    if (!grounded) return [];
    const score = /auth|secur|tenant|session|persist|idempoten|public|contract|critical|protected/iu.test(`${reference.title} ${grounded}`) ? 1 : 0;
    return [{ index, score, markdown: `- ${grounded.replace(/^[-*] /u, "")} ([${reference.title}](../references/${reference.slug}.md))` }];
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked.slice(0, 5).map((item) => item.markdown).join("\n");
}

export function agentPackDocuments(facts: FactsSnapshot, references: ReferenceDocument[]): AgentPackDocument[] {
  const commands = facts.stack.validationCommands?.length
    ? facts.stack.validationCommands.map((command) => `- \`${command}\``).join("\n")
    : "- Inspect checked-in task configuration; no verified command was detected.";
  const referenceMap = references.length
    ? references.map((reference) => {
      const scopes = referenceScopes(reference);
      const shown = scopes.slice(0, 2).map((scope) => `\`${scope}\``).join(", ");
      return `- [${reference.title}](../references/${reference.slug}.md) — ${shown}${scopes.length > 2 ? `, and ${scopes.length - 2} more scoped path(s)` : ""}.`;
    }).join("\n")
    : "- No focused reference guide was generated; use the root contract and local instructions.";
  const activeGates = facts.criticalPaths.paths.filter((entry) => entry.status === "active");
  const protectedMethods = protectedMethodsFromDirectives(facts.directives);
  // Deterministic citations often describe syntax (imports or declarations), not
  // a behavioral contract. Only reviewed references supply excerpted rules.
  const rules = facts.generation?.status === "ai-reviewed" ? priorityRules(facts, references) : "";
  const maintenanceMap = references.map((reference) => {
    const triggers = reference.markdown.match(/^## Maintenance triggers\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/mu)?.[1]?.trim();
    const firstTrigger = triggers?.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
    return `- [${reference.title}](../references/${reference.slug}.md): ${firstTrigger?.replace(/^[-*]\s+/u, "") ?? "Update when this concern's canonical behavior or extension seam changes."}`;
  }).join("\n");
  const testPaths = (facts.stack.sourcePaths ?? []).filter(isTestPath).slice(0, 24);
  return [
    {
      path: ".harnessme/agent-pack/agent.md",
      markdown: `# Repository agent contract

This is the canonical generated guide for changing this repository. The root \`AGENTS.md\` carries maintainer directives and the active safety gate; those directives take precedence over generated guidance. Read the [detailed operating contract](contract.md) only when the task needs its module map, change recipes, or evidence.

## First steps

1. Follow the root \`AGENTS.md\` and any closer scoped \`AGENTS.md\` for the files you will change.
2. For a local fix with a clear owner, inspect the current implementation, callers, and focused tests. Source code and tests resolve any conflict with generated descriptions.
3. When the owner, existing invariant, or extension seam is unclear, use [FEATURES.md](../FEATURES.md) and the relevant guide below. Run \`harnessme context <path>\` only when local navigation does not provide enough owner, dependency, or test context.

## Task reference map

${referenceMap}

## Protected boundaries

Foundational startup or orchestration entry methods, model or prompt factories, tool registrars, request or authentication handlers, persisted state contracts, and public event mappers require exact developer confirmation before editing. Explain why an established extension seam is insufficient. If the path has no active gate, register one before editing and follow the [critical change audit](critical-change-audit.md).

${protectedMethods.length ? `Maintainer directives protect these named methods: ${protectedMethods.map((method) => `\`${method}\``).join(", ")}. Follow their exact approval requirement before editing.` : "No named protected method was found in the maintainer directives."}

${activeGates.length ? `Active path gates are listed in the root \`AGENTS.md\`. Follow the [critical change audit](critical-change-audit.md) after explicit approval; [CRITICAL.md](../CRITICAL.md) is the approved-change log.` : "Review the root directives and proposed critical paths before changing a shared contract."}

${rules ? `## Grounded invariants for high-impact work\n\n${rules}\n\nRead a linked guide when its invariant or seam is relevant to the task; these excerpts do not replace the root directives.\n` : ""}

## Updating this agent pack

Correct a guide when the changed behavior makes its description inaccurate. Add a root pending note only for a new reusable workflow, invariant, extension seam, or validation rule; local cases within an existing rule need no note. If tool-specific loading behavior changes, update that adapter too. Keep this index short and put task details in focused references.

${maintenanceMap || "- No focused references were generated. Update the root instructions when the repository's operating contract changes."}
`,
    },
    {
      path: ".harnessme/agent-pack/contract.md",
      markdown: renderAgentsMd(facts)
        .replace(`${GENERATED_MARKER}\n`, "")
        .replace(/\]\(\.harnessme\//gu, "](../")
        .replace(/<!-- HARNESSME:PENDING:START -->[\s\S]*?<!-- HARNESSME:PENDING:END -->/u,
          "Add pending notes to the root `AGENTS.md`; `harnessme validate` reads them there."),
    },
    {
      path: ".harnessme/agent-pack/architecture.md",
      markdown: `# Architecture and change map

## How to use this pack

Read the root \`AGENTS.md\` first. Then use the smallest task-relevant guide below. These guides define the supported implementation seams, contracts, and validation; do not create a second path around an existing seam.

## Module map

${moduleMap(facts)}

## Task guides

${referenceMap}

## Cross-module changes

When a change crosses a request boundary, public interface, persisted representation, authentication context, or generated client contract, trace both sides before editing. Change all coupled owners together, add focused coverage for compatibility behavior, and record any new canonical workflow in the relevant guide.

## Validation baseline

${commands}
`,
    },
    {
      path: ".harnessme/agent-pack/critical-change-audit.md",
      markdown: `# Critical change audit

## When this applies

Use this process after the developer explicitly confirms an edit to a protected path or foundational entry method or core infrastructure contract. Register an active gate for a newly identified boundary before editing. The agent cannot self-approve or treat a draft as approval.

## Required workflow

1. State the exact protected file and named method, type, or contract being changed.
2. Explain why the established extension seam cannot satisfy the request.
3. Create the record with \`harnessme critical draft <path> --summary "<intent>"\` before editing.
4. Document behavior impact, compatibility risk, validation performed, and rollback notes in the record.
5. Stage the changed file and obtain approval bound to its exact staged content with \`harnessme critical approve <record> --approver <handle>\`.
6. Ship the approved record, \`.harnessme/CRITICAL.md\`, and \`.harnessme/critical.json\` with the code.

## Approval identity

The \`--approver\` flag records a handle; it does not authenticate the person who supplied it. Require code owner review in the repository's GitHub branch rules before merging protected changes. A passing local or CI gate proves artifact consistency, not that a human reviewed the change.

## Active protected paths

${activeGates.length ? activeGates.map((entry) => `- \`${entry.glob}\` [${entry.risk ?? "other"}]: ${entry.reason}`).join("\n") : "- No active critical paths are registered. Proposed paths remain advisory until activated."}

## Audit record standard

Every record must state: the core part changed; exact files and named methods/types; why an existing seam was insufficient; behavior and compatibility impact; validation; and a safe rollback plan. Do not write a vague change summary.
`,
    },
    {
      path: ".harnessme/agent-pack/testing-and-validation.md",
      markdown: `# Testing and validation guide

## Before changing behavior

Trace the changed implementation to its nearest focused test before writing code. Prefer tests that cross the same seam as the behavior: route and integration tests for wire contracts, storage tests for persisted behavior, and UI tests or builds for browser-client changes.

## Detected focused test areas

${testPaths.length ? testPaths.map((path) => `- \`${path}\``).join("\n") : "- No conventional test paths were detected. Inspect checked-in task configuration and adjacent source files before choosing coverage."}

## Validation ladder

1. Run the smallest relevant focused test or check while iterating.
2. Run every applicable verified command below before handing off behavior, contract, persistence, security, or cross-module changes.
3. State what was run, what was not run, and why in the final change summary.

${commands}

## Contract changes

For public interfaces, persisted data, authentication, generated clients, or critical paths, test the producer and consumer together. Do not substitute a unit test for an integration or compatibility check when the behavior crosses that interface.
`,
    },
  ];
}
