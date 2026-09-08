import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactsSnapshot } from "../packages/core/src/facts-store.js";
import { assessHarnessQuality } from "../packages/core/src/quality.js";
import { classifyRisk } from "../packages/core/src/risk.js";
import { criticalCandidates } from "../packages/analyzers/src/critical-candidates.js";
import { analyzeDocumentation } from "../packages/analyzers/src/documentation.js";
import { referenceDocuments } from "../packages/renderers/src/reference-pack.js";

function snapshot(authored = ""): FactsSnapshot {
  const generatedAt = new Date().toISOString();
  return {
    config: { schemaVersion: 1, targets: ["codex"], languages: ["TypeScript"], analysis: { exclude: [], maxFileBytes: 1000 }, distribution: { backend: "native" } },
    conventions: { schemaVersion: 1, generatedAt, facts: [{ id: "rule", category: "testing", statement: "Update tests.", confidence: 1, evidence: ["ev"] }] },
    stack: {
      schemaVersion: 1,
      generatedAt,
      languages: [{ name: "TypeScript", files: 1, percentage: 100 }],
      packageManagers: ["npm"],
      frameworks: [],
      dependencies: [],
      topLevelModules: ["src"],
      validationCommands: ["npm test"],
      projectSummary: "A service that verifies repository changes.",
      documentationPaths: ["README.md"],
    },
    evidence: [{ id: "ev", path: "src/core.ts", line: 1, kind: "ast", excerpt: "export class Core" }],
    architecture: "# Architecture\n",
    directives: "# Project directives\n",
    criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
    changes: { schemaVersion: 1, changes: [] },
    authoredInstructions: authored,
    referencePack: {
      schemaVersion: 1,
      generatedAt,
      documents: [{ slug: "core", title: "Core", scope: "src/**", description: "Core changes.", markdown: "# Core\n\n## Scope\n\nsrc\n\n## Responsibilities\n\nOwn core.\n\n## Invariants\n\nPreserve behavior.\n\n## Change workflow\n\nUpdate tests.\n\n## Validation\n\nnpm test\n" }],
    },
  };
}

describe("harness quality benchmark", () => {
  it("scores an operational layered harness at 100 and rejects a shallow inventory", () => {
    const operational = snapshot("# Repository instructions\n\n## Before editing\n\nInspect `src/core.ts`.\n\n## Operating rules\n\nPreserve contracts.\n\n## Core boundaries\n\n`src/core.ts`\n\n## Change workflows\n\nEdit `src/core.ts` and update tests.\n");
    expect(assessHarnessQuality(operational).score).toBe(100);

    const shallow = snapshot("# Stack\n\nTypeScript (100%).\n");
    shallow.stack.projectSummary = undefined;
    shallow.stack.documentationPaths = [];
    shallow.stack.validationCommands = [];
    shallow.evidence = [];
    shallow.conventions.facts = [];
    shallow.referencePack = undefined;
    expect(assessHarnessQuality(shallow).score).toBeLessThan(25);
  });

  it("detects documentation references that disagree with the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-doc-conflict-"));
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "README.md"), "See `src/missing.ts` before changing the service.\n");
    const result = await analyzeDocumentation(root, []);
    expect(result.conflicts).toEqual([expect.objectContaining({ document: "README.md", reference: "src/missing.ts" })]);
  });

  it("classifies critical paths by operational risk", () => {
    expect(classifyRisk("src/auth/session.ts")).toBe("security");
    expect(classifyRisk("src/db/repository.ts")).toBe("persistence");
    expect(classifyRisk("src/payments/invoice.ts")).toBe("billing");
    expect(classifyRisk(".github/workflows/release.yml")).toBe("deployment");
    expect(classifyRisk("src/api/contract.ts")).toBe("public-contract");
    expect(classifyRisk("src/core/runtime.ts")).toBe("shared-core");
  });

  it("surfaces rejected AI authorship and produces review-only risk candidates", () => {
    const facts = snapshot("# Repository instructions\n\n## Before editing\n\nInspect `src/core.ts`.\n\n## Operating rules\n\nPreserve contracts.\n\n## Core boundaries\n\n`src/core.ts`\n\n## Change workflows\n\nEdit `src/core.ts` and update tests.\n");
    facts.generation = {
      status: "deterministic-fallback",
      generatedAt: new Date().toISOString(),
      reason: "Invalid reference scope",
      activatedGates: [],
    };
    const quality = assessHarnessQuality(facts);
    expect(quality.score).toBe(60);
    expect(quality.checks).toContainEqual(expect.objectContaining({ id: "ai-authoring", passed: false }));
    expect(criticalCandidates([
      "src/api/middlewares/security.py",
      "src/api/services/experiment_repository.py",
      "src/api/routes/experiments.py",
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ risk: "security", path: "src/api/middlewares/security.py" }),
      expect.objectContaining({ risk: "persistence", path: "src/api/services/experiment_repository.py" }),
      expect.objectContaining({ risk: "public-contract", path: "src/api/routes/experiments.py" }),
    ]));
  });

  it("creates scoped deterministic references instead of expanding the root document", () => {
    const facts = snapshot();
    facts.referencePack = undefined;
    const documents = referenceDocuments(facts);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toEqual(expect.objectContaining({ slug: "src-workflow" }));
    expect(documents[0]?.markdown).toContain("## Change workflow");
    expect(documents[0]?.markdown).toContain("`npm test`");
  });
});
