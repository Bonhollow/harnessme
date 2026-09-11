import { describe, expect, it } from "vitest";
import type { OptimizedBuffer } from "@opentui/core";
import { createGraphScene, GRAPH_HELP } from "../packages/cli/src/dashboard/graph-scene.js";
import { createTerminalForceScene, findTerminalForceNeighbor, paintTerminalForceGraph } from "../packages/cli/src/dashboard/terminal-force-graph.js";
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

  it("moves force-view focus toward the arrow-key direction on screen", () => {
    const directionalGraph: KnowledgeGraph = {
      ...graph,
      nodes: [
        graph.nodes[0]!,
        graph.nodes[1]!,
        { id: "file:src/session.ts", kind: "file", label: "session.ts", path: "src/session.ts", provenance: "deterministic", citations: [] },
        { id: "test:tests/auth.test.ts", kind: "test", label: "auth.test.ts", path: "tests/auth.test.ts", provenance: "deterministic", citations: [] },
      ],
      edges: [
        ...graph.edges,
        { id: "implements:feature:auth->file:src/session.ts", from: "feature:auth", to: "file:src/session.ts", kind: "implements", provenance: "maintainer", citations: [] },
        { id: "verified-by:feature:auth->test:tests/auth.test.ts", from: "feature:auth", to: "test:tests/auth.test.ts", kind: "verified-by", provenance: "maintainer", citations: [] },
      ],
    };
    const selected = directionalGraph.nodes[0]!;
    const right = findTerminalForceNeighbor(directionalGraph, selected, { width: 64, height: 18 }, "right");
    const left = findTerminalForceNeighbor(directionalGraph, selected, { width: 64, height: 18 }, "left");
    expect(right?.id).not.toBe(selected.id);
    expect(left?.id).not.toBe(selected.id);
    expect(right?.id).not.toBe(left?.id);
  });

  it("paints a color-aware interactive topology scene", () => {
    const text: string[] = [];
    const cells: string[] = [];
    const buffer = {
      clear: () => {},
      drawText: (value: string) => text.push(value),
      setCell: (_x: number, _y: number, value: string) => cells.push(value),
    } as unknown as OptimizedBuffer;
    paintTerminalForceGraph(buffer, graph, graph.nodes[0]!, { width: 64, height: 18 });
    expect(text.join(" ")).toContain("● feature");
    expect(text.join(" ")).toContain("Authentication · feature");
    expect(text.join(" ")).toContain("relationships");
    expect(cells).toContain("◆");
  });
});
