import { describe, expect, it } from "vitest";
import { createKnowledgeArtifacts, defaultFeatureOverrides, findGraphPath, graphNeighborhood, resolveGraphNode, validateKnowledgeGraph, type FeaturePack, type RepositoryStructure } from "../packages/core/src/index.js";

const generatedAt = "2026-09-10T10:00:00.000Z";
const structure: RepositoryStructure = {
  schemaVersion: 1,
  generatedAt,
  files: [
    { path: "packages/api/auth.ts", kind: "source", module: "packages" },
    { path: "packages/api/auth.test.ts", kind: "test", module: "packages" },
  ],
  imports: [{ from: "packages/api/auth.test.ts", to: "packages/api/auth.ts", line: 1, excerpt: "import { authenticate } from './auth'" }],
  documents: ["docs/auth.md"],
};
const features: FeaturePack = {
  schemaVersion: 1,
  generatedAt,
  features: [{
    slug: "authentication",
    kind: "feature",
    title: "Authentication",
    summary: "Authenticates incoming requests.",
    scopes: ["packages/api/auth.ts"],
    responsibilities: ["Validate credentials."],
    invariants: ["Reject invalid credentials."],
    validation: ["npm test"],
    citations: [{ path: "packages/api/auth.ts", line: 1 }],
    relationships: [],
  }],
};

describe("knowledge graph", () => {
  it("builds stable feature, implementation, test, documentation, and critical-path relationships", () => {
    const artifacts = createKnowledgeArtifacts({
      structure,
      features,
      references: { schemaVersion: 1, generatedAt, documents: [] },
      criticalPaths: { schemaVersion: 1, paths: [{ glob: "packages/api/auth.ts", reason: "Security boundary", approvers: ["dev"], source: "explicit", status: "active", risk: "security" }], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
      overrides: defaultFeatureOverrides(),
    });
    expect(artifacts.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "feature:authentication" }),
      expect.objectContaining({ id: "file:packages/api/auth.ts" }),
      expect.objectContaining({ id: "test:packages/api/auth.test.ts" }),
    ]));
    expect(artifacts.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "feature:authentication", to: "file:packages/api/auth.ts", kind: "implements" }),
      expect.objectContaining({ from: "feature:authentication", to: "test:packages/api/auth.test.ts", kind: "verified-by" }),
      expect.objectContaining({ from: "test:packages/api/auth.test.ts", to: "file:packages/api/auth.ts", kind: "imports" }),
      expect.objectContaining({ from: "file:packages/api/auth.ts", kind: "protected-by" }),
    ]));
    expect(artifacts.documents.map((item) => item.path)).toEqual([".harnessme/FEATURES.md", ".harnessme/features/authentication.md"]);
    expect(artifacts.documents[1]?.markdown).toContain("## Agent support");
  });

  it("gives maintainer overrides precedence and exposes a bounded focus view", () => {
    const artifacts = createKnowledgeArtifacts({
      structure,
      features,
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
      overrides: {
        ...defaultFeatureOverrides(),
        features: [{ ...features.features[0]!, title: "Identity", summary: "Maintainer-owned identity behavior.", citations: [] }],
      },
    });
    expect(artifacts.graph.nodes).toContainEqual(expect.objectContaining({ id: "feature:authentication", label: "Identity", provenance: "maintainer" }));
    const view = graphNeighborhood(artifacts.graph, { focusId: "feature:authentication", radius: 1, reverse: false });
    expect(view.nodes.map((node) => node.id)).toContain("file:packages/api/auth.ts");
    expect(view.nodes.length).toBeLessThan(artifacts.graph.nodes.length + 1);
  });

  it("rejects scopes with no repository files", () => {
    expect(() => createKnowledgeArtifacts({
      structure,
      features: { ...features, features: [{ ...features.features[0]!, scopes: ["missing/**"] }] },
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
    })).toThrow("has no matching repository files");
  });

  it("migrates deep evidence-backed references into semantic concern nodes", () => {
    const artifacts = createKnowledgeArtifacts({
      structure,
      features: { schemaVersion: 1, generatedAt, features: [] },
      references: { schemaVersion: 1, generatedAt, documents: [{
        slug: "authentication", title: "Authentication", scope: "packages/api/", scopes: ["packages/api/"], description: "Request identity.",
        markdown: "# Authentication\n\n## Responsibilities\n\n- Authenticate requests.\n\n## Invariants\n\n- Reject invalid credentials. Evidence: `packages/api/auth.ts:1`.\n\n## Validation\n\n- `npm test`\n",
      }] },
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
    });
    expect(artifacts.graph.nodes).toContainEqual(expect.objectContaining({ id: "concern:authentication", provenance: "ai-reviewed" }));
    expect(artifacts.graph.edges).toContainEqual(expect.objectContaining({ from: "concern:authentication", to: "file:packages/api/auth.ts", kind: "implements" }));
    expect(artifacts.graph.edges).toContainEqual(expect.objectContaining({ from: "concern:authentication", to: "document:.harnessme/references/authentication.md", kind: "documented-by" }));
  });

  it("supports partial overrides without discarding generated fields", () => {
    const artifacts = createKnowledgeArtifacts({
      structure, features,
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
      overrides: { ...defaultFeatureOverrides(), features: [{ slug: "authentication", title: "Identity" }] },
    });
    expect(artifacts.graph.nodes).toContainEqual(expect.objectContaining({ id: "feature:authentication", label: "Identity", summary: "Authenticates incoming requests." }));
    expect(artifacts.documents.find((item) => item.path.endsWith("authentication.md"))?.markdown).toContain("Validate credentials.");
  });

  it("rejects noncanonical IDs, unsafe guides, reversed citation bounds, and unsupported AI relationships", () => {
    const base = createKnowledgeArtifacts({ structure, features, criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } } }).graph;
    expect(() => validateKnowledgeGraph({ ...base, nodes: base.nodes.map((node, index) => index ? node : { ...node, id: "wrong:id" }) })).toThrow("ID does not match");
    expect(() => validateKnowledgeGraph({ ...base, nodes: base.nodes.map((node) => node.kind === "feature" ? { ...node, guide: "docs/feature.md" } : node) })).toThrow("Invalid knowledge-graph guide");
    expect(() => validateKnowledgeGraph({ ...base, nodes: base.nodes.map((node) => node.kind === "feature" ? { ...node, citations: [{ path: "packages/api/auth.ts", line: 3, endLine: 2 }] } : node) })).toThrow();
  });

  it("reverses neighborhood edge direction without mutating the graph", () => {
    const graph = createKnowledgeArtifacts({ structure, features, criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } } }).graph;
    const normal = graphNeighborhood(graph, { focusId: "feature:authentication", radius: 1, reverse: false });
    const reversed = graphNeighborhood(graph, { focusId: "feature:authentication", radius: 1, reverse: true });
    expect(reversed.edges).toContainEqual(expect.objectContaining({ from: "file:packages/api/auth.ts", to: "feature:authentication" }));
    expect(normal.edges).toContainEqual(expect.objectContaining({ from: "feature:authentication", to: "file:packages/api/auth.ts" }));
  });

  it("finds the shortest path and preserves relationship direction", () => {
    const graph = createKnowledgeArtifacts({ structure, features, criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } } }).graph;
    const from = resolveGraphNode(graph, "packages/api/auth.test.ts");
    const to = resolveGraphNode(graph, "Authentication");
    const path = findGraphPath(graph, from.id, to.id);
    expect(path?.nodes.map((node) => node.id)).toEqual(["test:packages/api/auth.test.ts", "feature:authentication"]);
    expect(path?.steps).toEqual([expect.objectContaining({ direction: "reverse", edge: expect.objectContaining({ kind: "verified-by" }) })]);
  });

  it("returns no path across disconnected graph regions and rejects ambiguous references", () => {
    const graph = createKnowledgeArtifacts({ structure, features, criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } } }).graph;
    const isolated = { id: "file:isolated.ts", kind: "file" as const, label: "auth.ts", path: "isolated.ts", provenance: "deterministic" as const, citations: [] };
    const expanded = { ...graph, nodes: [...graph.nodes, isolated] };
    expect(findGraphPath(expanded, "feature:authentication", isolated.id)).toBeUndefined();
    expect(() => resolveGraphNode(expanded, "auth.ts")).toThrow("Ambiguous graph node");
  });

  it("allows an excluded feature to remove generated relationships targeting it", () => {
    const related: FeaturePack = { ...features, features: [
      { ...features.features[0]!, relationships: [{ to: "sessions", kind: "depends-on", citations: [{ path: "packages/api/auth.ts", line: 1 }] }] },
      { ...features.features[0]!, slug: "sessions", title: "Sessions", relationships: [] },
    ] };
    const artifacts = createKnowledgeArtifacts({
      structure, features: related,
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
      overrides: { ...defaultFeatureOverrides(), excludedFeatures: ["sessions"] },
    });
    expect(artifacts.graph.nodes.some((node) => node.id === "feature:sessions")).toBe(false);
    expect(artifacts.graph.edges.some((edge) => edge.to === "feature:sessions")).toBe(false);
  });
});
