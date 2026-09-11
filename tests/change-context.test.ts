import { describe, expect, it } from "vitest";
import { renderChangeContext, resolveChangeContext, type FactsSnapshot, type KnowledgeGraph } from "../packages/core/src/index.js";

const generatedAt = "2026-09-11T10:00:00.000Z";
const graph: KnowledgeGraph = {
  schemaVersion: 1, generatedAt, generation: "mixed", diagnostics: [],
  nodes: [
    { id: "feature:auth", kind: "feature", label: "Authentication", guide: ".harnessme/features/auth.md", provenance: "maintainer", citations: [] },
    { id: "feature:sessions", kind: "feature", label: "Sessions", guide: ".harnessme/features/sessions.md", provenance: "maintainer", citations: [] },
    { id: "file:src/auth.ts", kind: "file", label: "auth.ts", path: "src/auth.ts", provenance: "deterministic", citations: [] },
    { id: "file:src/db.ts", kind: "file", label: "db.ts", path: "src/db.ts", provenance: "deterministic", citations: [] },
    { id: "file:src/route.ts", kind: "file", label: "route.ts", path: "src/route.ts", provenance: "deterministic", citations: [] },
    { id: "test:tests/auth.test.ts", kind: "test", label: "auth.test.ts", path: "tests/auth.test.ts", provenance: "deterministic", citations: [] },
    { id: "document:.harnessme/features/auth.md", kind: "document", label: "Authentication guide", path: ".harnessme/features/auth.md", provenance: "deterministic", citations: [] },
    { id: "document:.harnessme/references/security.md", kind: "document", label: "Security guide", path: ".harnessme/references/security.md", provenance: "deterministic", citations: [] },
    { id: "critical:auth", kind: "critical-path", label: "src/auth.ts", scope: "src/auth.ts", summary: "Security boundary", provenance: "maintainer", citations: [] },
  ],
  edges: [
    { id: "implements:feature:auth->file:src/auth.ts", from: "feature:auth", to: "file:src/auth.ts", kind: "implements", provenance: "maintainer", citations: [] },
    { id: "documented-by:feature:auth->document:.harnessme/features/auth.md", from: "feature:auth", to: "document:.harnessme/features/auth.md", kind: "documented-by", provenance: "deterministic", citations: [] },
    { id: "documented-by:feature:auth->document:.harnessme/references/security.md", from: "feature:auth", to: "document:.harnessme/references/security.md", kind: "documented-by", provenance: "deterministic", citations: [] },
    { id: "verified-by:feature:auth->test:tests/auth.test.ts", from: "feature:auth", to: "test:tests/auth.test.ts", kind: "verified-by", provenance: "deterministic", citations: [] },
    { id: "depends-on:feature:auth->feature:sessions", from: "feature:auth", to: "feature:sessions", kind: "depends-on", provenance: "maintainer", citations: [] },
    { id: "imports:file:src/auth.ts->file:src/db.ts", from: "file:src/auth.ts", to: "file:src/db.ts", kind: "imports", provenance: "deterministic", citations: [] },
    { id: "imports:file:src/route.ts->file:src/auth.ts", from: "file:src/route.ts", to: "file:src/auth.ts", kind: "imports", provenance: "deterministic", citations: [] },
    { id: "protected-by:file:src/auth.ts->critical:auth", from: "file:src/auth.ts", to: "critical:auth", kind: "protected-by", provenance: "deterministic", citations: [] },
  ],
};

const facts = { stack: { validationCommands: ["npm test", "npm run lint"] }, knowledgeGraph: graph, documentationConflicts: [] } as unknown as FactsSnapshot;

describe("change context", () => {
  it("combines ownership, guides, dependencies, consumers, tests, gates, and validation", () => {
    const context = resolveChangeContext(facts, ["src/auth.ts"]);
    expect(context.owners.map((node) => node.id)).toEqual(["feature:auth"]);
    expect(context.guides.map((node) => node.path)).toEqual([".harnessme/features/auth.md", ".harnessme/references/security.md"]);
    expect(context.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "outgoing", node: expect.objectContaining({ id: "file:src/db.ts" }) }),
      expect.objectContaining({ direction: "incoming", node: expect.objectContaining({ id: "file:src/route.ts" }) }),
      expect.objectContaining({ direction: "outgoing", node: expect.objectContaining({ id: "feature:sessions" }) }),
    ]));
    expect(context.tests.map((node) => node.path)).toEqual(["tests/auth.test.ts"]);
    expect(context.protectedPaths.map((node) => node.scope)).toEqual(["src/auth.ts"]);
    expect(context.validationCommands).toEqual(["npm test", "npm run lint"]);
    expect(renderChangeContext(context)).toContain("Security guide");
    expect(renderChangeContext(context, { compact: true, pathPrefix: "../../" })).toContain("../../.harnessme/features/auth.md");
  });

  it("reports missing graph coverage and rejects paths outside the repository", () => {
    expect(resolveChangeContext(facts, ["src/missing.ts"]).warnings).toContain("No graph node exists for src/missing.ts; refresh after adding or moving files.");
    expect(() => resolveChangeContext(facts, ["../secret.txt"])).toThrow("must stay inside");
  });
});
