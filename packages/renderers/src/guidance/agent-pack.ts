import type { FactsSnapshot, ReferenceDocument } from "@harnessme/core";
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

export function agentPackDocuments(facts: FactsSnapshot, references: ReferenceDocument[]): AgentPackDocument[] {
  const commands = facts.stack.validationCommands?.length
    ? facts.stack.validationCommands.map((command) => `- \`${command}\``).join("\n")
    : "- Inspect checked-in task configuration; no verified command was detected.";
  const referenceMap = references.length
    ? references.map((reference) => `- [${reference.title}](../references/${reference.slug}.md) — applies to ${referenceScopes(reference).map((scope) => `\`${scope}\``).join(", ")}.`).join("\n")
    : "- No focused reference guide was generated; use the root contract and local instructions.";
  const activeGates = facts.criticalPaths.paths.filter((entry) => entry.status === "active");
  const testPaths = (facts.stack.sourcePaths ?? []).filter((path) => /(?:^|\/)tests?(?:\/|$)/iu.test(path)).slice(0, 24);
  return [
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

Use this process only after the developer explicitly confirms an edit to a protected path. The agent cannot self-approve or treat a draft as approval.

## Required workflow

1. State the exact protected file and named method, type, or contract being changed.
2. Explain why the established extension seam cannot satisfy the request.
3. Create the record with \`harnessme critical draft <path> --summary "<intent>"\` before editing.
4. Document behavior impact, compatibility risk, validation performed, and rollback notes in the record.
5. Stage the changed file and obtain approval bound to its exact staged content with \`harnessme critical approve <record> --approver <handle>\`.
6. Ship the approved record and \`.harnessme/CRITICAL.md\` with the code.

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
