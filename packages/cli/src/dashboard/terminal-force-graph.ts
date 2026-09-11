import { graphNeighborhood, type KnowledgeGraph, type KnowledgeNode } from "../../../core/src/index.js";
import { RGBA, type OptimizedBuffer } from "@opentui/core";

export interface TerminalForceOptions {
  width: number;
  height: number;
  radius?: number;
  reverse?: boolean;
}

interface Point {
  node: KnowledgeNode;
  x: number;
  y: number;
}

type ForceDirection = "up" | "down" | "left" | "right";

interface ForceLayout {
  width: number;
  height: number;
  nodes: KnowledgeNode[];
  edges: KnowledgeGraph["edges"];
  plotted: Map<string, Point>;
  neighborhoodSize: number;
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function put(grid: string[][], x: number, y: number, value: string, overwrite = false): void {
  if (y < 0 || y >= grid.length) return;
  for (let index = 0; index < value.length; index += 1) {
    const column = x + index;
    if (column < 0 || column >= grid[y]!.length) continue;
    if (overwrite || grid[y]![column] === " ") grid[y]![column] = value[index]!;
  }
}

function edgeGlyph(dx: number, dy: number): string {
  if (Math.abs(dx) > Math.abs(dy) * 2) return "─";
  if (Math.abs(dy) > Math.abs(dx) * 2) return "│";
  return dx * dy > 0 ? "╲" : "╱";
}

function drawEdge(grid: string[][], from: Point, to: Point): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (!steps) return;
  const glyph = edgeGlyph(dx, dy);
  for (let step = 1; step < steps; step += 1) {
    put(grid, Math.round(from.x + (dx * step) / steps), Math.round(from.y + (dy * step) / steps), glyph);
  }
}

const GRAPH_COLORS = {
  background: RGBA.fromHex("#0b1020"),
  edge: RGBA.fromHex("#334155"),
  directEdge: RGBA.fromHex("#0891b2"),
  muted: RGBA.fromHex("#64748b"),
  text: RGBA.fromHex("#e2e8f0"),
  selected: RGBA.fromHex("#ffffff"),
  selectedBackground: RGBA.fromHex("#155e75"),
  feature: RGBA.fromHex("#c084fc"),
  concern: RGBA.fromHex("#fb7185"),
  module: RGBA.fromHex("#fbbf24"),
  file: RGBA.fromHex("#60a5fa"),
  test: RGBA.fromHex("#4ade80"),
} as const;

function nodeColor(node: KnowledgeNode): RGBA {
  if (node.kind === "feature") return GRAPH_COLORS.feature;
  if (node.kind === "concern") return GRAPH_COLORS.concern;
  if (node.kind === "module") return GRAPH_COLORS.module;
  if (node.kind === "test") return GRAPH_COLORS.test;
  return GRAPH_COLORS.file;
}

function edgeArrow(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy) * 1.5) return dx > 0 ? "›" : "‹";
  if (Math.abs(dy) > Math.abs(dx) * 1.5) return dy > 0 ? "⌄" : "⌃";
  if (dx * dy > 0) return dx > 0 ? "⌟" : "⌜";
  return dx > 0 ? "⌝" : "⌞";
}

function drawBufferEdge(buffer: OptimizedBuffer, from: Point, to: Point, color: RGBA): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (!steps) return;
  const glyph = edgeGlyph(dx, dy);
  for (let step = 1; step < steps; step += 1) {
    buffer.setCell(
      Math.round(from.x + (dx * step) / steps),
      Math.round(from.y + (dy * step) / steps),
      glyph,
      color,
      GRAPH_COLORS.background,
    );
  }
  const middle = Math.floor(steps / 2);
  buffer.setCell(
    Math.round(from.x + (dx * middle) / steps),
    Math.round(from.y + (dy * middle) / steps),
    edgeArrow(from, to),
    color,
    GRAPH_COLORS.background,
  );
}

function createForceLayout(graph: KnowledgeGraph, selected: KnowledgeNode, options: TerminalForceOptions): ForceLayout {
  const width = Math.max(24, Math.floor(options.width));
  const height = Math.max(8, Math.floor(options.height));
  const neighborhood = graphNeighborhood(graph, { focusId: selected.id, radius: options.radius ?? 2, reverse: options.reverse ?? false });
  const degree = new Map<string, number>();
  for (const edge of neighborhood.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const adjacent = new Set(neighborhood.edges.flatMap((edge) => edge.from === selected.id ? [edge.to] : edge.to === selected.id ? [edge.from] : []));
  const maxNodes = Math.max(6, Math.min(20, Math.floor((width * height) / 90)));
  const nodes = [...neighborhood.nodes].sort((left, right) => {
    if (left.id === selected.id) return -1;
    if (right.id === selected.id) return 1;
    if (adjacent.has(left.id) !== adjacent.has(right.id)) return adjacent.has(left.id) ? -1 : 1;
    const semantic = (node: KnowledgeNode): number => ["feature", "concern", "module"].includes(node.kind) ? 1 : 0;
    return semantic(right) - semantic(left) || (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.id.localeCompare(right.id);
  }).slice(0, maxNodes);
  const included = new Set(nodes.map((node) => node.id));
  const edges = neighborhood.edges
    .filter((edge) => included.has(edge.from) && included.has(edge.to))
    .sort((left, right) => {
      const leftDirect = left.from === selected.id || left.to === selected.id ? 1 : 0;
      const rightDirect = right.from === selected.id || right.to === selected.id ? 1 : 0;
      return rightDirect - leftDirect || left.id.localeCompare(right.id);
    })
    .slice(0, Math.max(maxNodes - 1, maxNodes * 2));
  const points = new Map<string, { node: KnowledgeNode; x: number; y: number; vx: number; vy: number }>();
  nodes.forEach((node, index) => {
    const angle = ((hash(node.id) % 10000) / 10000) * Math.PI * 2;
    const distance = node.id === selected.id ? 0 : 0.35 + (index % 5) * 0.1;
    points.set(node.id, { node, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, vx: 0, vy: 0 });
  });
  const active = [...points.values()];
  for (let iteration = 0; iteration < 90; iteration += 1) {
    for (let left = 0; left < active.length; left += 1) {
      for (let right = left + 1; right < active.length; right += 1) {
        const a = active[left]!;
        const b = active[right]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distanceSquared = dx * dx + dy * dy + 0.01;
        const force = 0.0025 / distanceSquared;
        a.vx += dx * force; a.vy += dy * force;
        b.vx -= dx * force; b.vy -= dy * force;
      }
    }
    for (const edge of edges) {
      const from = points.get(edge.from)!;
      const to = points.get(edge.to)!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const force = (distance - 0.42) * 0.015 * (edge.weight ?? 1);
      from.vx += (dx / distance) * force; from.vy += (dy / distance) * force;
      to.vx -= (dx / distance) * force; to.vy -= (dy / distance) * force;
    }
    for (const point of active) {
      if (point.node.id === selected.id) { point.x = 0; point.y = 0; point.vx = 0; point.vy = 0; continue; }
      point.vx = (point.vx - point.x * 0.003) * 0.82;
      point.vy = (point.vy - point.y * 0.003) * 0.82;
      point.x = Math.max(-1, Math.min(1, point.x + point.vx));
      point.y = Math.max(-1, Math.min(1, point.y + point.vy));
    }
  }
  const plotted = new Map<string, Point>();
  for (const point of active) {
    plotted.set(point.node.id, {
      node: point.node,
      x: Math.round(2 + ((point.x + 1) / 2) * (width - 5)),
      y: Math.round(1 + ((point.y + 1) / 2) * (height - 4)),
    });
  }
  return { width, height, nodes, edges, plotted, neighborhoodSize: neighborhood.nodes.length };
}

/** Find the visible node nearest to the requested screen direction. */
export function findTerminalForceNeighbor(
  graph: KnowledgeGraph,
  selected: KnowledgeNode,
  options: TerminalForceOptions,
  direction: ForceDirection,
): KnowledgeNode | undefined {
  const layout = createForceLayout(graph, selected, options);
  const origin = layout.plotted.get(selected.id);
  if (!origin) return undefined;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  return [...layout.plotted.values()]
    .filter((point) => point.node.id !== selected.id)
    .map((point) => {
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      const forward = (horizontal ? dx : dy) * sign;
      const sideways = Math.abs(horizontal ? dy : dx);
      return { point, forward, score: Math.hypot(dx, dy) + sideways * 1.5 };
    })
    .filter((candidate) => candidate.forward > 0)
    .sort((left, right) => left.score - right.score || right.forward - left.forward || left.point.node.id.localeCompare(right.point.node.id))[0]?.point.node;
}

/** Paint the graph as a color-aware OpenTUI scene instead of a single text block. */
export function paintTerminalForceGraph(
  buffer: OptimizedBuffer,
  graph: KnowledgeGraph,
  selected: KnowledgeNode,
  options: TerminalForceOptions,
): void {
  const layout = createForceLayout(graph, selected, options);
  buffer.clear(GRAPH_COLORS.background);

  const legend = [
    ["● feature", GRAPH_COLORS.feature],
    ["● concern", GRAPH_COLORS.concern],
    ["● module", GRAPH_COLORS.module],
    ["● file", GRAPH_COLORS.file],
    ["● test", GRAPH_COLORS.test],
  ] as const;
  let legendX = 1;
  for (const [label, color] of legend) {
    if (legendX + label.length >= layout.width) break;
    buffer.drawText(label, legendX, 0, color, GRAPH_COLORS.background);
    legendX += label.length + 2;
  }

  for (const edge of layout.edges) {
    const from = layout.plotted.get(edge.from)!;
    const to = layout.plotted.get(edge.to)!;
    const direct = edge.from === selected.id || edge.to === selected.id;
    drawBufferEdge(buffer, from, to, direct ? GRAPH_COLORS.directEdge : GRAPH_COLORS.edge);
  }

  const adjacent = new Set(layout.edges.flatMap((edge) => edge.from === selected.id ? [edge.to] : edge.to === selected.id ? [edge.from] : []));
  const labeled = new Set([
    selected.id,
    ...layout.nodes.filter((node) => adjacent.has(node.id)).slice(0, 8).map((node) => node.id),
    ...layout.nodes.filter((node) => ["feature", "concern", "module"].includes(node.kind)).slice(0, 4).map((node) => node.id),
  ]);
  const points = [...layout.plotted.values()].sort((left, right) => renderPriority(left.node, selected.id) - renderPriority(right.node, selected.id));
  for (const point of points) {
    const isSelected = point.node.id === selected.id;
    const color = isSelected ? GRAPH_COLORS.selected : nodeColor(point.node);
    buffer.setCell(point.x, point.y, isSelected ? "◆" : "●", color, GRAPH_COLORS.background);
    if (!labeled.has(point.node.id)) continue;
    const rawLabel = isSelected ? `${point.node.label} · ${point.node.kind}` : point.node.label;
    const maxLength = Math.max(4, Math.min(28, layout.width - 4));
    const text = rawLabel.length > maxLength ? `${rawLabel.slice(0, maxLength - 1)}…` : rawLabel;
    const pill = ` ${isSelected ? "◆ " : ""}${text} `;
    let x = isSelected ? point.x - Math.floor(pill.length / 2) : point.x + 2;
    if (x + pill.length >= layout.width) x = Math.max(0, point.x - pill.length - 1);
    x = Math.max(0, x);
    buffer.drawText(
      pill.slice(0, layout.width - x),
      x,
      point.y,
      color,
      isSelected ? GRAPH_COLORS.selectedBackground : GRAPH_COLORS.background,
    );
  }

  const summary = `${layout.nodes.length}/${layout.neighborhoodSize} visible  ·  ${layout.edges.length} relationships  ·  depth ${options.radius ?? 2}`;
  buffer.drawText(summary.slice(0, layout.width), 0, layout.height - 1, GRAPH_COLORS.muted, GRAPH_COLORS.background);
}

/** Produce a deterministic force-directed graph frame for a fixed terminal viewport. */
export function createTerminalForceScene(graph: KnowledgeGraph, selected: KnowledgeNode, options: TerminalForceOptions): string {
  const { width, height, nodes, edges, plotted, neighborhoodSize } = createForceLayout(graph, selected, options);
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => " "));
  for (const edge of edges) drawEdge(grid, plotted.get(edge.from)!, plotted.get(edge.to)!);
  const labeled = new Set([selected.id, ...nodes.filter((node) => ["feature", "concern", "module"].includes(node.kind) && node.id !== selected.id).slice(0, 4).map((node) => node.id)]);
  for (const point of [...plotted.values()].sort((left, right) => renderPriority(left.node, selected.id) - renderPriority(right.node, selected.id))) {
    const isSelected = point.node.id === selected.id;
    const glyph = isSelected ? "◆" : ["feature", "concern", "module"].includes(point.node.kind) ? "◇" : "•";
    put(grid, point.x, point.y, glyph, true);
    if (labeled.has(point.node.id)) {
      const available = Math.max(0, width - point.x - 3);
      const label = point.node.label.slice(0, available);
      put(grid, point.x + 2, point.y, label, true);
    }
  }
  const summary = `${nodes.length}/${neighborhoodSize} nodes · ${edges.length} edges · radius ${options.radius ?? 2}`;
  put(grid, 0, height - 1, summary.slice(0, width), true);
  return grid.map((row) => row.join("").trimEnd()).join("\n").trimEnd();
}

function renderPriority(node: KnowledgeNode, selectedId: string): number {
  if (node.id === selectedId) return 2;
  return ["feature", "concern", "module"].includes(node.kind) ? 1 : 0;
}
