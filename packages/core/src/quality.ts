import type { FactsSnapshot } from "./facts-store.js";
import type { DocumentationConflict, HarnessQuality } from "./schema.js";

type DimensionId = HarnessQuality["dimensions"][number]["id"];
interface CheckInput { id: string; dimension: DimensionId; points: number; ratio: number; message: string; action: string }

function has(markdown: string, heading: string): boolean { return markdown.includes(`## ${heading}`); }
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const bodyStart = start + heading.length + 3;
  const next = markdown.slice(bodyStart).search(/^##\s+/mu);
  return markdown.slice(bodyStart, next < 0 ? undefined : bodyStart + next);
}
function bounded(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function ratio(value: number, target: number): number { return target > 0 ? bounded(value / target) : 0; }
function check(input: CheckInput): HarnessQuality["checks"][number] {
  const earned = Math.round(input.points * bounded(input.ratio) * 10) / 10;
  return { id: input.id, dimension: input.dimension, passed: input.ratio >= 0.8, points: input.points, earned, message: input.message };
}
function grade(score: number): HarnessQuality["grade"] {
  if (score >= 90) return "excellent";
  if (score >= 75) return "strong";
  if (score >= 55) return "developing";
  if (score >= 35) return "weak";
  return "critical";
}

export function assessHarnessQuality(facts: FactsSnapshot, conflicts: DocumentationConflict[] = [], renderedMarkdown?: string): HarnessQuality {
  const markdown = renderedMarkdown ?? facts.authoredInstructions ?? "";
  const structureFiles = facts.structure?.files ?? [];
  const fileNodes = facts.knowledgeGraph?.nodes.filter((node) => node.kind === "file" || node.kind === "test") ?? [];
  const semanticNodes = facts.knowledgeGraph?.nodes.filter((node) => node.kind === "feature" || node.kind === "concern") ?? [];
  const graphEdges = facts.knowledgeGraph?.edges ?? [];
  const coveredFiles = new Set(graphEdges.filter((edge) => edge.kind === "implements" || edge.kind === "verified-by").map((edge) => edge.to));
  const importEdges = graphEdges.filter((edge) => edge.kind === "imports").length;
  const dependencyTarget = Math.max(1, Math.ceil((fileNodes.length || structureFiles.length) * 0.75));
  const linkedFeatures = new Set(graphEdges.filter((edge) => edge.kind === "verified-by").map((edge) => edge.from));
  const semanticRelationships = graphEdges.filter((edge) => edge.kind === "depends-on" || edge.kind === "related-to");
  const citedRelationships = semanticRelationships.filter((edge) => edge.provenance !== "ai-reviewed" || edge.citations.length > 0);
  const relationshipEvidenceRatio = semanticRelationships.length ? ratio(citedRelationships.length, semanticRelationships.length) : 1;
  const references = facts.referencePack?.documents ?? [];
  const referenceHeadings = ["Scope", "Responsibilities", "Extension seams", "Invariants", "Change impact", "Anti-patterns", "Change workflow", "Validation", "Maintenance triggers"];
  const deepReferences = references.filter((reference) => referenceHeadings.every((heading) => has(reference.markdown, heading))).length;
  const knownPaths = new Set([...structureFiles.map((item) => item.path), ...(facts.stack.sourcePaths ?? []), ...(facts.stack.documentationPaths ?? [])]);
  const evidencePaths = new Set(facts.evidence.filter((item) => knownPaths.has(item.path)).map((item) => item.path));
  const evidenceTarget = Math.max(1, Math.min(20, Math.ceil(Math.max(1, structureFiles.length || knownPaths.size) * 0.15)));
  const evidenceIds = new Set(facts.evidence.map((item) => item.id));
  const groundedFacts = facts.conventions.facts.filter((fact) => fact.evidence.length > 0 && fact.evidence.every((id) => evidenceIds.has(id))).length;
  const workflow = section(markdown, "Change workflows");
  const groundedPaths = [...knownPaths, ...facts.stack.topLevelModules.map((module) => `${module}/`)];
  const workflowItems = workflow.split(/\r?\n/u).filter((line) => /^\s*(?:[-*]|\d+\.)\s+/u.test(line)).length;
  const workflowGrounded = groundedPaths.some((path) => workflow.includes(`\`${path}\``));
  const concreteCore = /`[^`]+`/u.test(section(markdown, "Core boundaries")) && !/no (?:explicit|concrete) core boundary/iu.test(section(markdown, "Core boundaries"));
  const validationCommands = [...new Set(facts.stack.validationCommands ?? [])];
  const validationKinds = new Set(validationCommands.flatMap((command) => [
    /(?:test|pytest|vitest|jest|rspec|cargo test|go test)/iu.test(command) ? "test" : "",
    /(?:lint|eslint|ruff|flake8|clippy)/iu.test(command) ? "lint" : "",
    /(?:build|compile|tsc|cargo check)/iu.test(command) ? "build" : "",
  ].filter(Boolean)));
  const activeGates = facts.criticalPaths.paths.filter((item) => item.status === "active").length;
  const proposedGates = facts.criticalPaths.paths.filter((item) => item.status === "proposed").length;
  const gateReviewRatio = activeGates + proposedGates ? activeGates / (activeGates + proposedGates) : 0.5;
  const generatedAt = Date.parse(facts.knowledgeGraph?.generatedAt ?? facts.stack.generatedAt);
  const ageDays = Number.isFinite(generatedAt) ? Math.max(0, (Date.now() - generatedAt) / 86_400_000) : Number.POSITIVE_INFINITY;
  const freshnessRatio = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.6 : ageDays <= 90 ? 0.25 : 0;
  const graphWarnings = facts.knowledgeGraph?.diagnostics.filter((item) => item.severity === "warning").length ?? 0;
  const graphErrors = facts.knowledgeGraph?.diagnostics.filter((item) => item.severity === "error").length ?? 0;
  const graphIntegrity = facts.knowledgeGraph?.nodes.length ? (graphErrors ? 0 : 1) : 0;
  const graphConsistency = graphIntegrity * (graphWarnings ? Math.max(0.4, 1 - graphWarnings * 0.15) : 1);
  const generationRatio = facts.generation?.status === "ai-reviewed" ? 1 : facts.generation?.status === "deterministic-fallback" ? 0 : 0.6;

  const definitions: CheckInput[] = [
    { id: "claim-grounding", dimension: "evidence", points: 8, ratio: ratio(groundedFacts, Math.max(1, facts.conventions.facts.length)), message: `${groundedFacts}/${facts.conventions.facts.length} operating claims have valid evidence references.`, action: "Attach valid evidence IDs to every operating claim." },
    { id: "evidence-breadth", dimension: "evidence", points: 6, ratio: ratio(evidencePaths.size, evidenceTarget), message: `${evidencePaths.size}/${evidenceTarget} target repository paths contribute direct evidence.`, action: "Capture evidence across additional owning modules and critical paths." },
    { id: "semantic-evidence", dimension: "evidence", points: 6, ratio: semanticNodes.length ? Math.min(ratio(semanticNodes.filter((node) => node.citations.length).length, semanticNodes.length), relationshipEvidenceRatio) : 0, message: `${semanticNodes.filter((node) => node.citations.length).length}/${semanticNodes.length} semantic nodes and ${citedRelationships.length}/${semanticRelationships.length} relationships are evidence-backed.`, action: "Add source citations to feature nodes and relationships." },
    { id: "graph-integrity", dimension: "navigation", points: 5, ratio: graphIntegrity, message: graphIntegrity ? "The graph is present and has no validation errors." : "The graph is absent or contains validation errors.", action: "Refresh and repair the knowledge graph." },
    { id: "semantic-coverage", dimension: "navigation", points: 8, ratio: ratio(coveredFiles.size, Math.max(1, fileNodes.length)), message: `${coveredFiles.size}/${fileNodes.length} graph files are assigned to a feature or concern.`, action: "Add or expand feature scopes for orphaned implementation and test files." },
    { id: "dependency-density", dimension: "navigation", points: 7, ratio: ratio(importEdges, dependencyTarget), message: `${importEdges} local imports mapped; ${dependencyTarget} is the repository-size target.`, action: "Configure source roots and import aliases, then refresh." },
    { id: "test-linkage", dimension: "navigation", points: 5, ratio: ratio(linkedFeatures.size, Math.max(1, semanticNodes.length)), message: `${linkedFeatures.size}/${semanticNodes.length} semantic nodes link to focused tests.`, action: "Connect feature scopes to focused tests or resolvable test imports." },
    { id: "purpose", dimension: "operations", points: 3, ratio: facts.stack.projectSummary ? 1 : 0, message: facts.stack.projectSummary ? "Repository purpose is grounded." : "Repository purpose is missing.", action: "Provide a grounded project purpose." },
    { id: "validation-depth", dimension: "operations", points: 6, ratio: Math.min(ratio(validationCommands.length, 2), ratio(validationKinds.size, 2)), message: `${validationCommands.length} commands cover ${validationKinds.size} validation categories.`, action: "Verify at least two complementary test, lint, or build commands." },
    { id: "operating-contract", dimension: "operations", points: 5, ratio: ["Before editing", "Operating rules"].filter((heading) => has(markdown, heading)).length / 2, message: "Pre-edit and operating instructions are evaluated independently.", action: "Add concrete pre-edit routing and imperative operating rules." },
    { id: "core-boundaries", dimension: "operations", points: 5, ratio: concreteCore ? 1 : 0, message: concreteCore ? "Concrete core boundaries are identified by path." : "No concrete core boundary is identified.", action: "Name high-impact files or directories and their invariants." },
    { id: "workflow-depth", dimension: "operations", points: 6, ratio: Math.min(ratio(workflowItems, 2), workflowGrounded ? 1 : 0), message: `${workflowItems} workflow steps found; path grounding is ${workflowGrounded ? "present" : "missing"}.`, action: "Add at least two path-grounded change workflows." },
    { id: "documentation-discovery", dimension: "documentation", points: 3, ratio: facts.stack.documentationPaths?.length ? 1 : 0, message: `${facts.stack.documentationPaths?.length ?? 0} repository documents are discoverable.`, action: "Route agents to task-relevant repository documentation." },
    { id: "reference-depth", dimension: "documentation", points: 7, ratio: ratio(deepReferences, Math.max(1, references.length)), message: `${deepReferences}/${references.length} scoped guides satisfy the deep-guide contract.`, action: "Add extension seams, invariants, impact, anti-patterns, validation, and maintenance triggers." },
    { id: "documentation-consistency", dimension: "documentation", points: 5, ratio: conflicts.length ? Math.max(0, 1 - conflicts.length * 0.25) : 1, message: conflicts.length ? `${conflicts.length} documentation/code conflicts remain.` : "No documentation/code conflicts were detected.", action: "Reconcile documentation with the implementation." },
    { id: "freshness", dimension: "governance", points: 4, ratio: freshnessRatio, message: `Graph facts are ${Math.floor(ageDays)} day(s) old.`, action: "Refresh after material architecture or contract changes." },
    { id: "graph-consistency", dimension: "governance", points: 4, ratio: graphConsistency, message: `${graphErrors} graph errors and ${graphWarnings} warnings are recorded.`, action: "Resolve graph diagnostics and orphaned-file warnings." },
    { id: "critical-review", dimension: "governance", points: 4, ratio: gateReviewRatio, message: `${activeGates} active and ${proposedGates} proposed critical paths.`, action: "Review proposed critical paths and activate or dismiss each one." },
    { id: "generation-confidence", dimension: "governance", points: 3, ratio: generationRatio, message: `Harness generation status is ${facts.generation?.status ?? "unknown"}.`, action: "Use reviewed authoring or validate deterministic guidance manually." },
  ];
  const checks = definitions.map(check);
  const rawScore = checks.reduce((sum, item) => sum + (item.earned ?? 0), 0);
  const score = Math.max(0, Math.min(100, Math.round(facts.generation?.status === "deterministic-fallback" ? Math.min(rawScore, 50) : rawScore)));
  const labels: Record<DimensionId, string> = { evidence: "Evidence", navigation: "Navigation", operations: "Operations", documentation: "Documentation", governance: "Governance" };
  const dimensions = (Object.keys(labels) as DimensionId[]).map((id) => {
    const items = checks.filter((item) => item.dimension === id);
    const maxPoints = items.reduce((sum, item) => sum + item.points, 0);
    const earned = Math.round(items.reduce((sum, item) => sum + (item.earned ?? 0), 0) * 10) / 10;
    return { id, label: labels[id], score: Math.round((earned / maxPoints) * 100), earned, maxPoints, summary: `${items.filter((item) => item.passed).length}/${items.length} checks at target` };
  });
  const metrics = [
    { id: "evidence-paths", label: "Evidence breadth", value: evidencePaths.size, target: evidenceTarget, percentage: Math.round(ratio(evidencePaths.size, evidenceTarget) * 100), detail: "repository paths contributing evidence" },
    { id: "semantic-coverage", label: "Feature coverage", value: coveredFiles.size, target: Math.max(1, fileNodes.length), percentage: Math.round(ratio(coveredFiles.size, Math.max(1, fileNodes.length)) * 100), detail: "files assigned to semantic nodes" },
    { id: "dependency-density", label: "Dependency map", value: importEdges, target: dependencyTarget, percentage: Math.round(ratio(importEdges, dependencyTarget) * 100), detail: "resolved local import edges" },
    { id: "test-linkage", label: "Test linkage", value: linkedFeatures.size, target: Math.max(1, semanticNodes.length), percentage: Math.round(ratio(linkedFeatures.size, Math.max(1, semanticNodes.length)) * 100), detail: "features linked to focused tests" },
    { id: "reference-depth", label: "Guide depth", value: deepReferences, target: Math.max(1, references.length), percentage: Math.round(ratio(deepReferences, Math.max(1, references.length)) * 100), detail: "guides satisfying the deep contract" },
  ];
  const severityOrder = { high: 0, medium: 1, low: 2 } as const;
  const findings = definitions.filter((item) => item.ratio < 0.8).map((item) => ({
    severity: (item.ratio < 0.25 && item.points >= 5 ? "high" : item.ratio < 0.6 ? "medium" : "low") as "high" | "medium" | "low",
    dimension: item.dimension, message: item.message, action: item.action,
  })).sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]).slice(0, 12);
  const confidence = Math.round(20 * Number(Boolean(facts.structure)) + 20 * Number(Boolean(facts.knowledgeGraph)) + 20 * ratio(evidencePaths.size, evidenceTarget) + 20 * ratio(validationCommands.length, 2) + 20 * (facts.generation?.status === "ai-reviewed" ? 1 : facts.generation?.status === "deterministic" ? 0.7 : 0.4));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), score, grade: grade(score), confidence, checks, dimensions, metrics, findings };
}
