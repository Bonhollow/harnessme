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
      },
      evidence: [{ id: "ev-1", path: ".editorconfig", line: 4, kind: "config", excerpt: "indent_style = space" }],
      architecture: "# Observed architecture\n\n## Top-level modules\n\n- `src/`\n",
      directives: "# Project directives\n\nNever commit credentials.\n",
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
      changes: { schemaVersion: 1, changes: [] },
    };
    const output = renderAgentsMd(facts, "- 2026-09-07: changed `src/a.ts`");
    expect(output).toContain("Use spaces. Evidence: `.editorconfig:4`");
    expect(output).toContain("Never commit credentials.");
    expect(output).toContain("HARNESSME:PENDING:START");
    expect(output).toContain("changed `src/a.ts`");
    expect(output).toContain("Before editing a path matching any rule below, stop and ask the developer");
  });
});
