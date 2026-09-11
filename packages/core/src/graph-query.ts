import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "./schema.js";

export interface GraphViewOptions { focusId?: string; radius: number; reverse: boolean }

function reversed(edge: KnowledgeEdge): KnowledgeEdge {
  return { ...edge, id: `${edge.kind}:${edge.to}->${edge.from}`, from: edge.to, to: edge.from };
}

/** Return a bounded graph projection without exposing traversal details to callers. */
export function graphNeighborhood(graph: KnowledgeGraph, options: GraphViewOptions): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  if (!options.focusId) {
    const nodes = graph.nodes.filter((node) => ["feature", "concern", "module"].includes(node.kind));
    const ids = new Set(nodes.map((node) => node.id));
    const edges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    return { nodes, edges: options.reverse ? edges.map(reversed) : edges };
  }
  const seen = new Set([options.focusId]);
  let frontier = new Set([options.focusId]);
  for (let depth = 0; depth < options.radius; depth += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.from)) next.add(edge.to);
      if (frontier.has(edge.to)) next.add(edge.from);
    }
    for (const id of next) seen.add(id);
    frontier = next;
  }
  const edges = graph.edges.filter((edge) => seen.has(edge.from) && seen.has(edge.to));
  return { nodes: graph.nodes.filter((node) => seen.has(node.id)), edges: options.reverse ? edges.map(reversed) : edges };
}
