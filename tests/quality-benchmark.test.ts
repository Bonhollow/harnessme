import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactsSnapshot } from "../packages/core/src/facts-store.js";
import { assessHarnessQuality } from "../packages/core/src/quality.js";
import { planQualityRemediations } from "../packages/core/src/quality-remediation.js";
import { classifyRisk } from "../packages/core/src/risk.js";
import { criticalCandidates } from "../packages/analyzers/src/critical-candidates.js";
import { analyzeDocumentation } from "../packages/analyzers/src/documentation.js";
import { referenceDocuments } from "../packages/renderers/src/reference-pack.js";
import { nestedAgentDocuments } from "../packages/renderers/src/guidance/nested-agents.js";
import { agentPackDocuments } from "../packages/renderers/src/guidance/agent-pack.js";

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
      sourcePaths: ["src/core.ts"],
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
      documents: [{ slug: "core", title: "Core", scope: "src/**", description: "Core changes.", markdown: "# Core\n\n## Scope\n\nsrc\n\n## Responsibilities\n\nOwn core.\n\n## Extension seams\n\nUse `src/core.ts`.\n\n## Invariants\n\nPreserve behavior.\n\n## Change impact\n\nUpdate callers and tests together.\n\n## Anti-patterns\n\nDo not duplicate core behavior.\n\n## Change workflow\n\nUpdate tests.\n\n## Validation\n\nnpm test\n\n## Maintenance triggers\n\nUpdate when the interface changes.\n" }],
    },
    knowledgeGraph: { schemaVersion: 1, generatedAt, generation: "deterministic", nodes: [{ id: "file:src/core.ts", kind: "file", label: "core.ts", path: "src/core.ts", provenance: "deterministic", citations: [{ path: "src/core.ts", line: 1 }] }], edges: [], diagnostics: [] },
  };
}

function comprehensiveSnapshot(): FactsSnapshot {
  const facts = snapshot("# Repository instructions\n\n## Before editing\n\nInspect `src/core.ts`, callers, tests, and documentation.\n\n## Operating rules\n\nPreserve contracts.\n\n## Core boundaries\n\n`src/core.ts` owns the public contract.\n\n## Change workflows\n\n- Edit `src/core.ts` through its exported interface.\n- Update `tests/core.test.ts` and run validation.\n");
  const generatedAt = facts.stack.generatedAt;
  facts.stack.sourcePaths = ["src/core.ts", "tests/core.test.ts"];
  facts.stack.validationCommands = ["npm test", "npm run lint"];
  facts.evidence.push({ id: "test-ev", path: "tests/core.test.ts", line: 1, kind: "ast", excerpt: "test('core')" });
  facts.structure = { schemaVersion: 1, generatedAt, files: [{ path: "src/core.ts", kind: "source", module: "src" }, { path: "tests/core.test.ts", kind: "test", module: "tests" }], imports: [], documents: ["README.md"] };
  facts.generation = { status: "ai-reviewed", generatedAt, activatedGates: [] };
  facts.criticalPaths.paths = [{ glob: "src/core.ts", reason: "Shared contract", approvers: ["developer"], source: "ai-reviewed", status: "active", risk: "public-contract" }];
  facts.knowledgeGraph = {
    schemaVersion: 1, generatedAt, generation: "ai-reviewed", diagnostics: [],
    nodes: [
      { id: "feature:core", kind: "feature", label: "Core", guide: ".harnessme/features/core.md", provenance: "ai-reviewed", citations: [{ path: "src/core.ts", line: 1 }] },
      { id: "file:src/core.ts", kind: "file", label: "core.ts", path: "src/core.ts", provenance: "deterministic", citations: [{ path: "src/core.ts", line: 1 }] },
      { id: "test:tests/core.test.ts", kind: "test", label: "core.test.ts", path: "tests/core.test.ts", provenance: "deterministic", citations: [{ path: "tests/core.test.ts", line: 1 }] },
    ],
    edges: [
      { id: "implements:feature:core->file:src/core.ts", from: "feature:core", to: "file:src/core.ts", kind: "implements", provenance: "ai-reviewed", citations: [{ path: "src/core.ts", line: 1 }] },
      { id: "verified-by:feature:core->test:tests/core.test.ts", from: "feature:core", to: "test:tests/core.test.ts", kind: "verified-by", provenance: "deterministic", citations: [{ path: "tests/core.test.ts", line: 1 }] },
      { id: "imports:test:tests/core.test.ts->file:src/core.ts", from: "test:tests/core.test.ts", to: "file:src/core.ts", kind: "imports", provenance: "deterministic", citations: [{ path: "tests/core.test.ts", line: 1 }] },
      { id: "imports:file:src/core.ts->test:tests/core.test.ts", from: "file:src/core.ts", to: "test:tests/core.test.ts", kind: "imports", provenance: "deterministic", citations: [{ path: "src/core.ts", line: 1 }] },
    ],
  };
  return facts;
}

describe("harness quality benchmark", () => {
  it("does not confuse generated operational prose with comprehensive quality", () => {
    const operational = snapshot("# Repository instructions\n\n## Before editing\n\nInspect `src/core.ts`.\n\n## Operating rules\n\nPreserve contracts.\n\n## Core boundaries\n\n`src/core.ts`\n\n## Change workflows\n\nEdit `src/core.ts` and update tests.\n");
    const operationalQuality = assessHarnessQuality(operational);
    expect(operationalQuality.score).toBeGreaterThanOrEqual(55);
    expect(operationalQuality.score).toBeLessThan(75);
    expect(operationalQuality.findings).toEqual(expect.arrayContaining([expect.objectContaining({ dimension: "navigation" })]));

    const shallow = snapshot("# Stack\n\nTypeScript (100%).\n");
    shallow.stack.projectSummary = undefined;
    shallow.stack.documentationPaths = [];
    shallow.stack.validationCommands = [];
    shallow.evidence = [];
    shallow.conventions.facts = [];
    shallow.referencePack = undefined;
    expect(assessHarnessQuality(shallow).score).toBeLessThan(25);
  });

  it("creates an executable remediation plan for every failed quality check", () => {
    const quality = assessHarnessQuality(snapshot("# Stack\n\nTypeScript.\n"));
    const plans = planQualityRemediations(quality);
    expect(plans).toHaveLength(quality.findings.length);
    expect(plans.every((plan) => plan.projectedScore >= quality.score && plan.recoverablePoints > 0)).toBe(true);
    expect(plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "semantic-coverage", workflow: "features" }),
      expect.objectContaining({ id: "critical-review", workflow: "gates" }),
      expect.objectContaining({ id: "dependency-density", workflow: "refresh-deterministic" }),
      expect.objectContaining({ id: "operating-contract", workflow: "refresh-ai" }),
    ]));
  });

  it("awards an excellent score only to a comprehensive evidence and navigation fixture", () => {
    const quality = assessHarnessQuality(comprehensiveSnapshot());
    expect(quality.score).toBeGreaterThanOrEqual(95);
    expect(quality.grade).toBe("excellent");
    expect(quality.dimensions).toHaveLength(5);
    expect(quality.metrics).toHaveLength(5);
    expect(quality.findings).toHaveLength(0);
  });

  it("materially penalizes missing navigation coverage instead of rewarding initialization", () => {
    const complete = comprehensiveSnapshot();
    const completeScore = assessHarnessQuality(complete).score;
    complete.knowledgeGraph!.edges = complete.knowledgeGraph!.edges.filter((edge) => edge.kind !== "imports" && edge.kind !== "implements" && edge.kind !== "verified-by");
    const degraded = assessHarnessQuality(complete);
    expect(degraded.score).toBeLessThanOrEqual(completeScore - 15);
    expect(degraded.dimensions.find((dimension) => dimension.id === "navigation")?.score).toBeLessThan(50);
    expect(degraded.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "navigation", severity: "high" }),
    ]));
  });

  it("does not award reference-pack quality to shallow scoped notes", () => {
    const facts = snapshot("# Repository instructions\n\n## Before editing\n\nInspect `src/core.ts`.\n\n## Operating rules\n\nPreserve contracts.\n\n## Core boundaries\n\n`src/core.ts`\n\n## Change workflows\n\nEdit `src/core.ts` and update tests.\n");
    facts.referencePack!.documents[0]!.markdown = "# Core\n\n## Scope\n\n`src/**`\n\n## Responsibilities\n\nOwn core.\n";
    expect(assessHarnessQuality(facts).checks).toContainEqual(expect.objectContaining({ id: "reference-depth", passed: false }));
  });

  it("does not award feature-graph quality when the graph is absent", () => {
    const facts = snapshot("# Repository instructions\n\n## Before editing\n\nInspect `src/core.ts`.\n\n## Operating rules\n\nPreserve contracts.\n\n## Core boundaries\n\n`src/core.ts`\n\n## Change workflows\n\nEdit `src/core.ts` and update tests.\n");
    facts.knowledgeGraph = undefined;
    expect(assessHarnessQuality(facts).checks).toContainEqual(expect.objectContaining({ id: "graph-integrity", passed: false }));
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
    expect(quality.score).toBeLessThanOrEqual(50);
    expect(quality.checks).toContainEqual(expect.objectContaining({ id: "generation-confidence", passed: false }));
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

  it("creates concern-specific references and nested module guidance", () => {
    const facts = snapshot();
    facts.referencePack = undefined;
    facts.stack.sourcePaths = [
      "src/coreval/api/services/token_provider.py",
      "src/coreval/api/services/experiment_repository.py",
      "src/coreval/evals/experiment_runner.py",
      "src/coreval/api/services/dataset_service.py",
    ];
    facts.evidence.push(
      { id: "auth", path: "src/coreval/api/services/token_provider.py", line: 20, kind: "ai", excerpt: "TokenProviderError guards token refresh" },
      { id: "db", path: "src/coreval/api/services/experiment_repository.py", line: 57, kind: "ai", excerpt: "idempotency_key unique index" },
    );
    const references = referenceDocuments(facts);
    expect(references).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Authentication and security", scope: "src/coreval/api/**" }),
      expect.objectContaining({ title: "Persistence and idempotency", scope: "src/coreval/api/**" }),
      expect.objectContaining({ title: "Evaluation execution", scope: "src/coreval/evals/**" }),
      expect.objectContaining({ title: "Dataset synchronization", scope: "src/coreval/api/**" }),
    ]));
    expect(references.find((item) => item.title === "Authentication and security")?.markdown).toContain("## Anti-patterns");
    expect(references.find((item) => item.title === "Authentication and security")?.markdown).toContain("`src/coreval/api/services/token_provider.py`");
    expect(nestedAgentDocuments(facts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ directory: "src/coreval/api", markdown: expect.stringContaining("## Local ownership") }),
      expect.objectContaining({ directory: "src/coreval/api", markdown: expect.stringContaining("## Change workflow") }),
    ]));
    expect(nestedAgentDocuments(facts, [{
      slug: "persistence",
      title: "Persistence",
      scope: "src/coreval/api/models/**",
      description: "Persistence rules.",
      markdown: "Use `src/coreval/api/services/experiment_repository.py` with the models.",
    }])).toEqual([
      expect.objectContaining({ directory: "src/coreval/api" }),
    ]);
    expect(agentPackDocuments(facts, references)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ".harnessme/agent-pack/architecture.md", markdown: expect.stringContaining("## Cross-module changes") }),
      expect.objectContaining({ path: ".harnessme/agent-pack/critical-change-audit.md", markdown: expect.stringContaining("## Audit record standard") }),
      expect.objectContaining({ path: ".harnessme/agent-pack/testing-and-validation.md", markdown: expect.stringContaining("## Validation ladder") }),
    ]));
  });
});
