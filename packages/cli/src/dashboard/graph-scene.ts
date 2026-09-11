import { graphNeighborhood, type KnowledgeEdge, type KnowledgeGraph, type KnowledgeNode } from "../../../core/src/index.js";

export const GRAPH_HELP = "↑/↓ node  ←/→ follow  G 3D view  Backspace history  e evidence  m manage  +/- radius  / search  f filter  i reverse  Esc/q back";

function fit(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value.padEnd(width);
}

function edgeLabel(edge: KnowledgeEdge, nodes: Map<string, KnowledgeNode>, incoming: boolean): string {
  const node = nodes.get(incoming ? edge.from : edge.to);
  return `${node?.label ?? (incoming ? edge.from : edge.to)} [${edge.kind}]`;
}

/** Render a deterministic, terminal-safe three-column graph scene. */
export function createGraphScene(graph: KnowledgeGraph, selected: KnowledgeNode, radius: number, reverse: boolean, width = 96): string {
  const neighborhood = graphNeighborhood(graph, { focusId: selected.id, radius, reverse });
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const inbound = neighborhood.edges.filter((edge) => edge.to === selected.id).map((edge) => edgeLabel(edge, byId, true));
  const outbound = neighborhood.edges.filter((edge) => edge.from === selected.id).map((edge) => edgeLabel(edge, byId, false));
  const adjacent = new Set(neighborhood.edges.flatMap((edge) => edge.from === selected.id ? [edge.to] : edge.to === selected.id ? [edge.from] : []));
  const distant = neighborhood.nodes.filter((node) => node.id !== selected.id && !adjacent.has(node.id)).map((node) => `${node.kind}: ${node.label}`);
  if (width < 72) {
    return [
      reverse ? "REVERSED RELATIONSHIPS" : "RELATIONSHIPS",
      ...inbound.map((value) => `← ${value}`),
      `◆ ${selected.label} (${selected.kind})`,
      ...outbound.map((value) => `→ ${value}`),
      ...distant.slice(0, 8).map((value) => `· ${value}`),
      `${neighborhood.nodes.length} nodes · ${neighborhood.edges.length} edges · radius ${radius}`,
    ].join("\n");
  }
  const column = Math.max(18, Math.floor((width - 10) / 3));
  const rows = Math.max(inbound.length, outbound.length, 1);
  const lines = [
    `${fit(reverse ? "DEPENDENCIES" : "IMPACT", column)}    ${fit("FOCUS", column)}    ${fit(reverse ? "IMPACT" : "DEPENDENCIES", column)}`,
    `${"─".repeat(column)}    ${"─".repeat(column)}    ${"─".repeat(column)}`,
  ];
  for (let index = 0; index < rows; index += 1) {
    lines.push(`${fit(inbound[index] ? `← ${inbound[index]}` : "", column)}    ${fit(index === 0 ? `◆ ${selected.label}` : index === 1 ? `  ${selected.kind}` : "", column)}    ${fit(outbound[index] ? `→ ${outbound[index]}` : "", column)}`);
  }
  if (distant.length) lines.push("", "RADIUS NEIGHBORS", ...distant.slice(0, 12).map((value) => `  · ${value}`));
  lines.push("", `${neighborhood.nodes.length} nodes · ${neighborhood.edges.length} edges · radius ${radius}`);
  return lines.join("\n");
}
