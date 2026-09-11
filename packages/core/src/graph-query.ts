import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "./schema.js";

export interface GraphViewOptions { focusId?: string; radius: number; reverse: boolean }

export interface GraphPathStep {
  from: KnowledgeNode;
  to: KnowledgeNode;
  edge: KnowledgeEdge;
  direction: "forward" | "reverse";
}

export interface GraphPath {
  nodes: KnowledgeNode[];
  steps: GraphPathStep[];
}

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

/** Resolve a human-facing node reference without making callers understand graph IDs. */
export function resolveGraphNode(graph: KnowledgeGraph, query: string): KnowledgeNode {
  const value = query.trim().toLowerCase();
  if (!value) throw new Error("A graph node ID, path, or label is required.");
  const exactId = graph.nodes.find((node) => node.id.toLowerCase() === value);
  if (exactId) return exactId;
  const candidates = graph.nodes.filter((node) =>
    node.path?.toLowerCase() === value
    || node.guide?.toLowerCase() === value
    || node.label.toLowerCase() === value
    || node.id.slice(node.id.indexOf(":") + 1).toLowerCase() === value,
  );
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1) throw new Error(`Ambiguous graph node '${query}': ${candidates.map((node) => node.id).join(", ")}`);
  throw new Error(`Unknown graph node '${query}'. Use a node ID, repository path, or unique label.`);
}

/** Find the deterministic shortest relationship path, retaining each edge's true direction. */
export function findGraphPath(graph: KnowledgeGraph, fromId: string, toId: string): GraphPath | undefined {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const start = byId.get(fromId);
  const target = byId.get(toId);
  if (!start || !target) return undefined;
  if (start.id === target.id) return { nodes: [start], steps: [] };

  const adjacency = new Map<string, Array<{ nodeId: string; edge: KnowledgeEdge; direction: GraphPathStep["direction"] }>>();
  for (const edge of graph.edges) {
    const outgoing = adjacency.get(edge.from) ?? [];
    outgoing.push({ nodeId: edge.to, edge, direction: "forward" });
    adjacency.set(edge.from, outgoing);
    const incoming = adjacency.get(edge.to) ?? [];
    incoming.push({ nodeId: edge.from, edge, direction: "reverse" });
    adjacency.set(edge.to, incoming);
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => left.edge.kind.localeCompare(right.edge.kind)
      || left.nodeId.localeCompare(right.nodeId)
      || left.direction.localeCompare(right.direction));
  }

  const visited = new Set([start.id]);
  const queue = [start.id];
  const previous = new Map<string, { nodeId: string; edge: KnowledgeEdge; direction: GraphPathStep["direction"] }>();
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor.nodeId)) continue;
      visited.add(neighbor.nodeId);
      previous.set(neighbor.nodeId, { nodeId: current, edge: neighbor.edge, direction: neighbor.direction });
      if (neighbor.nodeId === target.id) {
        queue.length = 0;
        break;
      }
      queue.push(neighbor.nodeId);
    }
  }
  if (!previous.has(target.id)) return undefined;

  const steps: GraphPathStep[] = [];
  let current = target.id;
  while (current !== start.id) {
    const entry = previous.get(current);
    if (!entry) return undefined;
    steps.push({ from: byId.get(entry.nodeId)!, to: byId.get(current)!, edge: entry.edge, direction: entry.direction });
    current = entry.nodeId;
  }
  steps.reverse();
  return { nodes: [start, ...steps.map((step) => step.to)], steps };
}
