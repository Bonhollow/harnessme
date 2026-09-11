import type { FactsSnapshot } from "./facts-store.js";
import { posixPath } from "./files.js";
import type { KnowledgeEdge, KnowledgeNode } from "./schema.js";

export interface ChangeContextTarget {
  path: string;
  resolved: boolean;
  ownerIds: string[];
  guidePaths: string[];
  testPaths: string[];
}

export interface ChangeContextRelation {
  node: KnowledgeNode;
  edge: KnowledgeEdge;
  direction: "outgoing" | "incoming";
}

export interface ChangeContext {
  targets: ChangeContextTarget[];
  owners: KnowledgeNode[];
  guides: KnowledgeNode[];
  dependencies: ChangeContextRelation[];
  tests: KnowledgeNode[];
  protectedPaths: KnowledgeNode[];
  validationCommands: string[];
  warnings: string[];
}

export interface ChangeContextRenderOptions {
  compact?: boolean;
  pathPrefix?: string;
}

function uniqueNodes(nodes: Array<KnowledgeNode | undefined>, limit = 20): KnowledgeNode[] {
  return [...new Map(nodes.filter((node): node is KnowledgeNode => Boolean(node)).map((node) => [node.id, node])).values()]
    .sort((left, right) => left.id.localeCompare(right.id)).slice(0, limit);
}

function safePath(value: string): string {
  const path = posixPath(value.trim()).replace(/^\.\//u, "");
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//u.test(path) || path.split("/").includes("..")) {
    throw new Error(`Context paths must stay inside the repository: ${value}`);
  }
  return path;
}

/** Resolve the bounded operating context an agent needs before editing repository paths. */
export function resolveChangeContext(facts: FactsSnapshot, requestedPaths: string[]): ChangeContext {
  if (!requestedPaths.length) throw new Error("At least one repository path is required.");
  const graph = facts.knowledgeGraph;
  if (!graph) throw new Error("No knowledge graph exists. Run `harnessme refresh` or `harnessme sync` first.");
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesFrom = new Map<string, KnowledgeEdge[]>();
  const edgesTo = new Map<string, KnowledgeEdge[]>();
  for (const edge of graph.edges) {
    edgesFrom.set(edge.from, [...(edgesFrom.get(edge.from) ?? []), edge]);
    edgesTo.set(edge.to, [...(edgesTo.get(edge.to) ?? []), edge]);
  }
  const paths = [...new Set(requestedPaths.map(safePath))];
  const targetNodes = paths.map((path) => graph.nodes.find((node) => node.path === path && (node.kind === "file" || node.kind === "test")));
  const ownersByTarget = new Map<string, KnowledgeNode[]>();
  const guidesByTarget = new Map<string, KnowledgeNode[]>();
  const testsByTarget = new Map<string, KnowledgeNode[]>();
  const ownerNodes: KnowledgeNode[] = [];
  const guideNodes: KnowledgeNode[] = [];
  const testNodes: KnowledgeNode[] = [];
  const protectedNodes: KnowledgeNode[] = [];
  const relations: ChangeContextRelation[] = [];
  const warnings: string[] = [];

  for (const [index, path] of paths.entries()) {
    const target = targetNodes[index];
    if (!target) {
      warnings.push(`No graph node exists for ${path}; refresh after adding or moving files.`);
      continue;
    }
    const semanticOwners = (edgesTo.get(target.id) ?? [])
      .filter((edge) => edge.kind === "implements" || edge.kind === "verified-by")
      .map((edge) => byId.get(edge.from))
      .filter((node): node is KnowledgeNode => Boolean(node && (node.kind === "feature" || node.kind === "concern")));
    const moduleOwners = (edgesTo.get(target.id) ?? [])
      .filter((edge) => edge.kind === "contains")
      .map((edge) => byId.get(edge.from)).filter((node): node is KnowledgeNode => Boolean(node));
    const owners = uniqueNodes([...semanticOwners, ...moduleOwners], 8);
    ownersByTarget.set(path, owners);
    ownerNodes.push(...owners);
    if (!semanticOwners.length) warnings.push(`${path} is not assigned to a feature or concern.`);

    const ownerEdges = owners.flatMap((owner) => edgesFrom.get(owner.id) ?? []);
    const guides = uniqueNodes(ownerEdges.filter((edge) => edge.kind === "documented-by").map((edge) => byId.get(edge.to)), 8);
    guidesByTarget.set(path, guides);
    guideNodes.push(...guides);
    if (!guides.length) warnings.push(`${path} has no graph-linked guide.`);

    const tests = uniqueNodes([
      ...ownerEdges.filter((edge) => edge.kind === "verified-by").map((edge) => byId.get(edge.to)),
      ...(edgesTo.get(target.id) ?? []).filter((edge) => edge.kind === "imports").map((edge) => byId.get(edge.from)).filter((node) => node?.kind === "test"),
    ], 12);
    testsByTarget.set(path, tests);
    testNodes.push(...tests);

    const relatedEdges = [
      ...(edgesFrom.get(target.id) ?? []).filter((edge) => edge.kind === "imports"),
      ...(edgesTo.get(target.id) ?? []).filter((edge) => edge.kind === "imports"),
      ...ownerEdges.filter((edge) => edge.kind === "depends-on" || edge.kind === "related-to"),
      ...owners.flatMap((owner) => (edgesTo.get(owner.id) ?? []).filter((edge) => edge.kind === "depends-on" || edge.kind === "related-to")),
    ];
    for (const edge of relatedEdges) {
      const outgoing = edge.from === target.id || owners.some((owner) => owner.id === edge.from);
      const node = byId.get(outgoing ? edge.to : edge.from);
      if (node) relations.push({ node, edge, direction: outgoing ? "outgoing" : "incoming" });
    }
    const protectionEdges = [
      ...(edgesFrom.get(target.id) ?? []),
      ...owners.flatMap((owner) => edgesFrom.get(owner.id) ?? []),
    ].filter((edge) => edge.kind === "protected-by");
    protectedNodes.push(...protectionEdges.map((edge) => byId.get(edge.to)).filter((node): node is KnowledgeNode => Boolean(node)));
  }

  for (const diagnostic of graph.diagnostics) warnings.push(`${diagnostic.severity}: ${diagnostic.message}`);
  for (const conflict of facts.documentationConflicts ?? []) {
    if (paths.includes(conflict.implementationPath ?? "") || paths.includes(conflict.reference)) warnings.push(`Documentation conflict in ${conflict.document}:${conflict.line}: ${conflict.message}`);
  }
  const owners = uniqueNodes(ownerNodes, 12);
  const guides = uniqueNodes(guideNodes, 12);
  const tests = uniqueNodes(testNodes, 16);
  return {
    targets: paths.map((path, index) => ({
      path,
      resolved: Boolean(targetNodes[index]),
      ownerIds: (ownersByTarget.get(path) ?? []).map((node) => node.id),
      guidePaths: (guidesByTarget.get(path) ?? []).flatMap((node) => node.path ? [node.path] : []),
      testPaths: (testsByTarget.get(path) ?? []).flatMap((node) => node.path ? [node.path] : []),
    })),
    owners,
    guides,
    dependencies: [...new Map(relations.map((relation) => [`${relation.direction}:${relation.edge.id}`, relation])).values()].slice(0, 20),
    tests,
    protectedPaths: uniqueNodes(protectedNodes, 12),
    validationCommands: [...new Set(facts.stack.validationCommands ?? [])],
    warnings: [...new Set(warnings)].slice(0, 20),
  };
}

function bullets(values: string[], empty: string): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

/** Render the canonical context result for agents, terminals, and generated instructions. */
export function renderChangeContext(context: ChangeContext, options: ChangeContextRenderOptions = {}): string {
  const compact = options.compact === true;
  const ownerLines = context.owners.map((node) => `${node.label} (${node.kind})${node.guide ? ` — \`${node.guide}\`` : ""}`);
  const guideLines = context.guides.flatMap((node) => node.path ? [`[${node.label}](${options.pathPrefix ?? ""}${node.path})`] : []);
  const dependencyLines = context.dependencies.map(({ node, edge, direction }) =>
    `${direction === "outgoing" ? "depends on" : "used by"} ${node.label} via \`${edge.kind}\`${node.path ? ` (\`${node.path}\`)` : ""}`);
  const testLines = context.tests.flatMap((node) => node.path ? [`\`${node.path}\``] : []);
  const protectedLines = context.protectedPaths.map((node) => `\`${node.scope ?? node.label}\`${node.summary ? ` — ${node.summary}` : ""}`);
  if (compact) return `## Graph-routed context

${bullets(ownerLines, "No semantic owner is mapped; inspect the nearest module interface.")}

Guides: ${guideLines.length ? guideLines.join(", ") : "none mapped"}  
Tests: ${testLines.length ? testLines.join(", ") : "none mapped"}  
Dependencies: ${dependencyLines.length ? dependencyLines.slice(0, 6).join("; ") : "none mapped"}
`;
  return `# Change context

## Target paths

${bullets(context.targets.map((target) => `\`${target.path}\`${target.resolved ? "" : " — not present in the graph"}`), "No paths selected.")}

## Ownership

${bullets(ownerLines, "No semantic owner is mapped; inspect the nearest module interface.")}

## Applicable guides

${bullets(guideLines, "No graph-linked guide is available.")}

## Dependencies and consumers

${bullets(dependencyLines, "No direct dependency or consumer relationship is mapped.")}

## Focused tests

${bullets(testLines, "No focused test is mapped; inspect nearby tests before editing.")}

## Protected paths

${bullets(protectedLines, "No active critical-path rule applies.")}

## Validation

${bullets(context.validationCommands.map((command) => `\`${command}\``), "No verified validation command is available.")}

## Warnings

${bullets(context.warnings, "No context-delivery warning.")}
`;
}
