import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { renderForceGraphHtml } from "../packages/renderers/src/force-graph.js";
import type { KnowledgeGraph } from "../packages/core/src/schema.js";

const graph: KnowledgeGraph = {
  schemaVersion: 1, generatedAt: "2026-09-11T08:00:00.000Z", generation: "mixed", diagnostics: [],
  nodes: [
    { id: "feature:auth", kind: "feature", label: "Auth </script><script>alert(1)</script>", guide: ".harnessme/features/auth.md", provenance: "maintainer", citations: [] },
    { id: "file:src/auth.ts", kind: "file", label: "auth.ts", path: "src/a'uth.ts", provenance: "deterministic", citations: [{ path: "src/auth.ts", line: 1 }] },
  ],
  edges: [{ id: "implements:feature:auth->file:src/auth.ts", from: "feature:auth", to: "file:src/auth.ts", kind: "implements", provenance: "maintainer", citations: [] }],
};

describe("3D force graph renderer", () => {
  it("renders a dependency-free interactive artifact with safely embedded graph data", () => {
    const html = renderForceGraphHtml(graph);
    expect(html).toContain("HarnessME · 3D Graph");
    expect(html).toContain("Whole graph");
    expect(html).toContain("Pause spin");
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("Auth </script><script>alert(1)</script>");
    expect(html).toContain("Auth \\u003c/script>");
    expect(html).toContain("replaceAll(\"'\",\"%27\")");
    const script = html.match(/<script>([\s\S]*)<\/script>/u)?.[1];
    expect(script).toBeTruthy();
    expect(() => new vm.Script(script!)).not.toThrow();
  });
});
