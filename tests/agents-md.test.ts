import { describe, expect, it } from "vitest";
import { renderAgentsMd } from "../packages/renderers/src/agents-md.js";
import type { FactsSnapshot } from "../packages/core/src/facts-store.js";

describe("AGENTS.md renderer", () => {
  it("keeps observed facts, evidence, directives, and scratch input distinct", () => {
    const facts: FactsSnapshot = {
      config: {
        schemaVersion: 1,
        targets: ["codex"],
        languages: ["TypeScript"],
        analysis: { exclude: [], maxFileBytes: 1000 },
        distribution: { backend: "native" },
      },
      conventions: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        facts: [{ id: "fact-1", category: "formatting", statement: "Use spaces.", confidence: 1, evidence: ["ev-1"] }],
      },
      stack: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        languages: [{ name: "TypeScript", files: 2, percentage: 100 }],
        packageManagers: ["npm"],
        frameworks: [],
        dependencies: [],
        topLevelModules: ["src"],
        validationCommands: ["npm test"],
        projectSummary: "A service for evaluating repository changes.",
        documentationPaths: ["README.md", "docs/ARCHITECTURE.md"],
      },
      evidence: [{ id: "ev-1", path: ".editorconfig", line: 4, kind: "config", excerpt: "indent_style = space" }],
      architecture: "# Observed architecture\n\n## Top-level modules\n\n- `src/`\n",
      directives: "# Project directives\n\n## Imported from the pre-existing AGENTS.md\n\n# Existing rules\n\n## Hard Rules\n\nNever commit credentials.\n\n- Do not touch entry methods unless the owner approves:\n  `start_server()`, `Runner.run()`.\n- Never edit core functions without approval:\n  `initialize_core()`.\n- Keep changes scoped.\n\n```sh\n# shell comment\n```\n",
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
      changes: { schemaVersion: 1, changes: [] },
    };
    const output = renderAgentsMd(facts, "- 2026-09-07: changed `src/a.ts`");
    expect(output).toContain("Use spaces. Evidence: `.editorconfig:4`");
    expect(output).toContain("## Operating rules");
    expect(output).toContain("## Core boundaries");
    expect(output).toContain("## Change workflows");
    expect(output).toContain(".harnessme/agent-pack/architecture.md");
    expect(output).toContain(".harnessme/agent-pack/critical-change-audit.md");
    expect(output).toContain(".harnessme/agent-pack/testing-and-validation.md");
    expect(output).toContain("harnessme context <path>");
    expect(output).toContain("`docs/ARCHITECTURE.md`");
    expect(output).toContain("A service for evaluating repository changes.");
    expect(output).toContain("`npm test`");
    expect(output).toContain("discovery does not prove they pass on the current baseline");
    expect(output).not.toContain("100%");
    expect(output).not.toContain("Operational technologies");
    expect(output).toContain("Never commit credentials.");
    expect(output.indexOf("Before editing, read and follow the Project directives below")).toBeLessThan(output.indexOf("## Project purpose"));
    expect(output.slice(0, output.indexOf("## Project purpose"))).toContain("Protected methods named in those directives: `start_server()`, `Runner.run()`, `initialize_core()`.");
    expect(output.slice(0, output.indexOf("## Project purpose"))).not.toContain("Keep changes scoped");
    expect(output).toContain("### Imported from the pre-existing AGENTS.md");
    expect(output).toContain("#### Existing rules");
    expect(output).toContain("##### Hard Rules");
    expect(output).toContain("```sh\n# shell comment\n```");
    expect(output).toContain("HARNESSME:PENDING:START");
    expect(output).toContain("changed `src/a.ts`");
    expect(output).toContain("Before editing a path matching any active rule below, stop and ask the developer");
  });

  it("distributes an AI-authored document while retaining managed safety sections", () => {
    const facts: FactsSnapshot = {
      config: { schemaVersion: 1, targets: ["codex"], languages: ["TypeScript"], analysis: { exclude: [], maxFileBytes: 1000 }, distribution: { backend: "native" } },
      conventions: { schemaVersion: 1, generatedAt: new Date().toISOString(), facts: [] },
      stack: { schemaVersion: 1, generatedAt: new Date().toISOString(), languages: [], packageManagers: [], frameworks: [], dependencies: [], topLevelModules: [] },
      evidence: [],
      architecture: "# Observed architecture\n",
      directives: "# Project directives\n\nNever edit the public API without review.\n",
      criticalPaths: {
        schemaVersion: 1,
        paths: [
          { glob: "src/core.ts", reason: "Shared public contract", approvers: ["owner"], source: "ai-reviewed", status: "active" },
          { glob: "src/example.ts", reason: "Candidate", approvers: ["owner"], source: "heuristic", status: "proposed" },
        ],
        heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 },
      },
      changes: { schemaVersion: 1, changes: [] },
      authoredInstructions: "# Repository instructions\n\n## AI-authored guidance\n\nUse the repository's boundaries.\n\n## Validation\n\nRun configured checks.\n\n## Critical-path safety gate\n\nBefore editing a listed path, ask the developer for explicit confirmation. The selected gates are proposals until activated.\n\n{{HARNESSME_CRITICAL_PATHS}}\n\n## Proposed critical paths\n\nThese candidates are active.\n\n## Verified material changes\n\n{{HARNESSME_VERIFIED_CHANGES}}\n\n## Project directives\n\n{{HARNESSME_DIRECTIVES}}\n\n## Keeping this harness current\n\n{{HARNESSME_PENDING}}\n",
    };
    const output = renderAgentsMd(facts);
    expect(output).toContain("## AI-authored guidance");
    expect(output.indexOf("Before editing, read and follow the Project directives below")).toBeLessThan(output.indexOf("## AI-authored guidance"));
    expect(output).toContain("Never edit the public API without review.");
    expect(output).toContain("discovery does not prove they pass on the current baseline");
    expect(output).not.toContain("{{HARNESSME_");
    expect(output).toContain(".harnessme/FEATURES.md");
    expect(output).toContain("`src/core.ts` [other]: Shared public contract");
    expect(output).toContain("Active rules apply now; proposed candidates are advisory until activated.");
    expect(output).not.toContain("The selected gates are proposals until activated.");
    expect(output).toContain("1 candidate awaits review in `.harnessme/critical-paths.yaml`");
    expect(output).not.toContain("These candidates are active.");
    expect(output.match(/Proposed critical paths/gu)).toHaveLength(1);
    expect(output).toContain("HARNESSME:PENDING:START");
    expect(output).not.toContain("{{HARNESSME_");
  });

  it("rejects altered AI templates with duplicate managed placeholders", () => {
    const facts: FactsSnapshot = {
      config: { schemaVersion: 1, targets: ["codex"], languages: [], analysis: { exclude: [], maxFileBytes: 1000 }, distribution: { backend: "native" } },
      conventions: { schemaVersion: 1, generatedAt: new Date().toISOString(), facts: [] },
      stack: { schemaVersion: 1, generatedAt: new Date().toISOString(), languages: [], packageManagers: [], frameworks: [], dependencies: [], topLevelModules: [] },
      evidence: [],
      architecture: "# Observed architecture\n",
      directives: "# Project directives\n",
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
      changes: { schemaVersion: 1, changes: [] },
      authoredInstructions: `# Repository instructions\n\n${"{{HARNESSME_CRITICAL_PATHS}}"}\n${"{{HARNESSME_CRITICAL_PATHS}}"}\n${"{{HARNESSME_VERIFIED_CHANGES}}"}\n${"{{HARNESSME_DIRECTIVES}}"}\n${"{{HARNESSME_PENDING}}"}\n`,
    };
    expect(() => renderAgentsMd(facts)).toThrow("exactly once");
  });
});
