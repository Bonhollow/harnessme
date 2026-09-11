import type { AnalysisResult } from "@harnessme/analyzers";
import type { FactsSnapshot } from "./facts-store.js";
import { minimatch } from "minimatch";
import { createKnowledgeArtifacts } from "./knowledge-graph.js";
import { defaultFeatureOverrides, defaultFeaturePack } from "./schema.js";

export interface DriftItem {
  severity: "error" | "warning";
  category: string;
  message: string;
}

function setDifference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

export function detectDrift(current: AnalysisResult, committed: FactsSnapshot): DriftItem[] {
  const drift: DriftItem[] = [];
  const committedConflicts = new Set((committed.documentationConflicts ?? []).map((item) => `${item.document}:${item.line}:${item.reference}`));
  const currentConflicts = new Set((current.documentationConflicts ?? []).map((item) => `${item.document}:${item.line}:${item.reference}`));
  for (const conflict of current.documentationConflicts ?? []) {
    if (committedConflicts.has(`${conflict.document}:${conflict.line}:${conflict.reference}`)) continue;
    drift.push({
      severity: "warning",
      category: "documentation",
      message: `${conflict.document}:${conflict.line} references missing repository path ${conflict.reference}`,
    });
  }
  for (const conflict of committed.documentationConflicts ?? []) {
    if (currentConflicts.has(`${conflict.document}:${conflict.line}:${conflict.reference}`)) continue;
    drift.push({
      severity: "warning",
      category: "documentation",
      message: `Recorded documentation conflict was resolved or moved: ${conflict.document}:${conflict.line} (${conflict.reference})`,
    });
  }
  const oldLanguages = committed.stack.languages.map((item) => item.name);
  const newLanguages = current.stack.languages.map((item) => item.name);
  for (const language of setDifference(newLanguages, oldLanguages)) {
    drift.push({ severity: "error", category: "stack", message: `New language detected: ${language}` });
  }
  for (const language of setDifference(oldLanguages, newLanguages)) {
    drift.push({ severity: "error", category: "stack", message: `Recorded language no longer detected: ${language}` });
  }

  const oldDependencies = committed.stack.dependencies.map((item) => `${item.kind}:${item.name}:${item.version}`);
  const newDependencies = current.stack.dependencies.map((item) => `${item.kind}:${item.name}:${item.version}`);
  for (const dependency of setDifference(newDependencies, oldDependencies)) {
    drift.push({ severity: "error", category: "dependency", message: `Dependency changed or added: ${dependency}` });
  }
  for (const dependency of setDifference(oldDependencies, newDependencies)) {
    drift.push({ severity: "error", category: "dependency", message: `Recorded dependency changed or removed: ${dependency}` });
  }

  for (const module of setDifference(current.stack.topLevelModules, committed.stack.topLevelModules)) {
    drift.push({ severity: "error", category: "architecture", message: `New top-level module: ${module}/` });
  }
  for (const module of setDifference(committed.stack.topLevelModules, current.stack.topLevelModules)) {
    drift.push({ severity: "warning", category: "architecture", message: `Recorded top-level module is gone: ${module}/` });
  }

  const oldConventions = committed.conventions.facts.map((item) => item.statement);
  const newConventions = current.conventions.facts.map((item) => item.statement);
  for (const fact of setDifference(newConventions, oldConventions)) {
    drift.push({ severity: "warning", category: "convention", message: `New observed convention: ${fact}` });
  }
  for (const fact of setDifference(oldConventions, newConventions)) {
    drift.push({ severity: "warning", category: "convention", message: `Recorded convention no longer has evidence: ${fact}` });
  }
  const currentFactsById = new Map(current.conventions.facts.map((fact) => [fact.id, fact]));
  for (const fact of committed.conventions.facts) {
    const currentFact = currentFactsById.get(fact.id);
    if (currentFact && currentFact.evidence.join("|") !== fact.evidence.join("|")) {
      drift.push({ severity: "warning", category: "evidence", message: `Citations moved or changed for fact: ${fact.statement}` });
    }
  }

  if (committed.criticalPaths.heuristics.enabled) {
    const thresholds = committed.criticalPaths.heuristics;
    for (const hotspot of current.hotspots.filter((item) =>
      item.changes >= thresholds.minChanges
      || item.fanIn >= thresholds.minFanIn
      || item.score >= thresholds.minScore
    )) {
      const registered = committed.criticalPaths.paths.some((item) => minimatch(hotspot.path, item.glob, { dot: true }));
      if (!registered) {
        drift.push({
          severity: "warning",
          category: "governance",
          message: `Critical candidate is not registered: ${hotspot.path} (${hotspot.changes} changes, ${hotspot.fanIn} inbound imports, score ${hotspot.score})`,
        });
      }
    }
  }
  if (current.structure && committed.structure) {
    const oldFiles = committed.structure.files.map((item) => `${item.kind}:${item.path}`);
    const newFiles = current.structure.files.map((item) => `${item.kind}:${item.path}`);
    const oldImports = committed.structure.imports.map((item) => `${item.from}->${item.to}`);
    const newImports = current.structure.imports.map((item) => `${item.from}->${item.to}`);
    const addedFiles = setDifference(newFiles, oldFiles);
    const removedFiles = setDifference(oldFiles, newFiles);
    const addedImports = setDifference(newImports, oldImports);
    const removedImports = setDifference(oldImports, newImports);
    if (addedFiles.length || removedFiles.length) drift.push({ severity: "warning", category: "graph", message: `Feature graph structure changed: ${addedFiles.length} file(s) added and ${removedFiles.length} removed.` });
    if (addedImports.length || removedImports.length) drift.push({ severity: "warning", category: "graph", message: `Feature graph imports changed: ${addedImports.length} edge(s) added and ${removedImports.length} removed.` });
  }
  if (committed.structure && committed.knowledgeGraph && committed.referencePack) {
    try {
      const expected = createKnowledgeArtifacts({ structure: committed.structure, features: committed.featurePack ?? defaultFeaturePack(committed.structure.generatedAt), references: committed.referencePack, criticalPaths: committed.criticalPaths, overrides: committed.featureOverrides ?? defaultFeatureOverrides(), referenceProvenance: committed.generation?.status === "ai-reviewed" ? "ai-reviewed" : "deterministic" }).graph;
      const canonical = (graph: typeof expected): string => JSON.stringify({ ...graph, generatedAt: "" });
      if (canonical(expected) !== canonical(committed.knowledgeGraph)) drift.push({ severity: "error", category: "graph", message: "The committed knowledge graph differs from canonical stored facts; run `harnessme sync`." });
    } catch (error) {
      drift.push({ severity: "error", category: "graph", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return drift;
}
