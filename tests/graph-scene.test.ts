import { describe, expect, it } from "vitest";
import { createGraphScene, GRAPH_HELP } from "../packages/cli/src/dashboard/graph-scene.js";
import { createTerminalForceScene } from "../packages/cli/src/dashboard/terminal-force-graph.js";
import type { KnowledgeGraph } from "../packages/core/src/schema.js";

const graph: KnowledgeGraph = {
  schemaVersion: 1, generatedAt: "2026-09-10T10:00:00.000Z", generation: "deterministic", diagnostics: [],
  nodes: [
    { id: "feature:auth", kind: "feature", label: "Authentication", guide: ".harnessme/features/auth.md", provenance: "maintainer", citations: [] },
    { id: "file:src/auth.ts", kind: "file", label: "auth.ts", path: "src/auth.ts", provenance: "deterministic", citations: [{ path: "src/auth.ts", line: 1 }] },
  ],
  edges: [{ id: "implements:feature:auth->file:src/auth.ts", from: "feature:auth", to: "file:src/auth.ts", kind: "implements", provenance: "maintainer", citations: [] }],
};

describe("graph scene", () => {
  it("renders stable columns and a narrow fallback", () => {
    expect(createGraphScene(graph, graph.nodes[0]!, 1, false, 96)).toContain("IMPACT");
    expect(createGraphScene(graph, graph.nodes[0]!, 1, false, 96)).toContain("→ auth.ts [implements]");
    expect(createGraphScene(graph, graph.nodes[0]!, 1, false, 60)).toContain("◆ Authentication (feature)");
  });

  it("advertises the force-view switch from the structured explorer", () => {
    expect(GRAPH_HELP).toContain("G force view");
  });

  it("renders a deterministic force-directed graph inside terminal bounds", () => {
    const first = createTerminalForceScene(graph, graph.nodes[0]!, { width: 64, height: 18 });
    const second = createTerminalForceScene(graph, graph.nodes[0]!, { width: 64, height: 18 });
    expect(first).toBe(second);
    expect(first.split("\n").length).toBeLessThanOrEqual(18);
    expect(first.split("\n").every((line) => line.length <= 64)).toBe(true);
    expect(first).toContain("◆");
    expect(first).toContain("Authentication");
    expect(first).toMatch(/[·─│╱╲]/u);
  });
});
