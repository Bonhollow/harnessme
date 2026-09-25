import { defineCommand } from "citty";
import { join } from "node:path";
import { createKnowledgeArtifacts, defaultFeatureOverrides, defaultFeaturePack, detectDrift, exists, harnessWorkflowContent, managedHarnessWorkflowPath, matchingCriticalPath, readFacts, readText } from "@harnessme/core";
import { analyzeProject, protectedEntryCandidates } from "@harnessme/analyzers";
import { agentPackDocuments, extractPending, GENERATED_MARKER, nestedAgentDocuments, referenceDocuments, renderEntrypointMd } from "@harnessme/renderers";
import { createProgress, info, warn } from "../output.js";
import { projectRoot } from "../project.js";
import { auditGuidanceLinks } from "../guidance-links.js";

export async function scan(root: string, onPhase?: (message: string) => void): Promise<ReturnType<typeof detectDrift>> {
  onPhase?.("Loading the committed harness facts");
  const facts = await readFacts(root);
  onPhase?.("Analyzing the current repository");
  const deterministic = await analyzeProject({ root, ...facts.config.analysis, aiFallback: undefined, review: undefined });
  const parsedPaths = new Set(deterministic.sourceFiles);
  const unsupportedPaths = (facts.stack.sourcePaths ?? []).filter((path) => !parsedPaths.has(path));
  const needsInference = Boolean(facts.config.analysis.aiFallback && (await Promise.all(unsupportedPaths.map((path) => exists(join(root, path))))).some(Boolean));
  const current = needsInference ? await analyzeProject({ root, ...facts.config.analysis }) : deterministic;
  const aiEvidence = new Set(facts.evidence.filter((item) => item.kind === "ai").map((item) => item.id));
  const comparableFacts = needsInference ? facts : {
    ...facts,
    conventions: { ...facts.conventions, facts: facts.conventions.facts.filter((item) => !item.evidence.some((id) => aiEvidence.has(id))) },
    documentationConflicts: facts.documentationConflicts?.filter((item) => item.kind === "missing-path"),
  };
  for (const message of current.warnings) warn(message);
  const drift = detectDrift(current, comparableFacts);
  for (const protectedEntry of await protectedEntryCandidates(root, current.sourceFiles, facts.directives)) {
    if (matchingCriticalPath(facts.criticalPaths, protectedEntry.path)) continue;
    drift.push({
      severity: "error",
      category: "governance",
      message: `${protectedEntry.path} is protected by imported maintainer directives but has no active gate; run \`harnessme refresh\`.`,
    });
  }
  const agentsPath = join(root, "AGENTS.md");
  const agents = await exists(agentsPath) ? await readText(agentsPath) : undefined;
  if (!agents || !agents.startsWith(GENERATED_MARKER) || agents !== renderEntrypointMd(facts, extractPending(agents))) {
    drift.push({ severity: "error", category: "guidance", message: "AGENTS.md differs from canonical stored facts; run `harnessme sync`." });
  }
  const workflowPath = await managedHarnessWorkflowPath(root);
  const workflow = await exists(join(root, workflowPath)) ? await readText(join(root, workflowPath)) : undefined;
  const expectedWorkflow = harnessWorkflowContent();
  if (workflow !== expectedWorkflow) {
    drift.push({ severity: "error", category: "governance", message: `${workflowPath} differs from canonical generated CI gate; run \`harnessme sync\`.` });
  }
  const references = referenceDocuments(facts);
  const generatedMarkdown = ["AGENTS.md"];
  for (const reference of references) {
    const path = `.harnessme/references/${reference.slug}.md`;
    generatedMarkdown.push(path);
    const expected = `${GENERATED_MARKER}\n${reference.markdown.trim()}\n`;
    if (!await exists(join(root, path)) || await readText(join(root, path)) !== expected) {
      drift.push({ severity: "error", category: "guidance", message: `${path} differs from canonical stored facts; run \`harnessme sync\`.` });
    }
  }
  for (const document of agentPackDocuments(facts, references)) {
    generatedMarkdown.push(document.path);
    const expected = `${GENERATED_MARKER}\n${document.markdown.trim()}\n`;
    if (!await exists(join(root, document.path)) || await readText(join(root, document.path)) !== expected) {
      drift.push({ severity: "error", category: "guidance", message: `${document.path} differs from canonical stored facts; run \`harnessme sync\`.` });
    }
  }
  if (facts.structure && facts.referencePack) {
    try {
      const artifacts = createKnowledgeArtifacts({ structure: facts.structure, features: facts.featurePack ?? defaultFeaturePack(facts.structure.generatedAt), references: facts.referencePack, criticalPaths: facts.criticalPaths, overrides: facts.featureOverrides ?? defaultFeatureOverrides(), referenceProvenance: facts.generation?.status === "ai-reviewed" ? "ai-reviewed" : "deterministic" });
      for (const document of nestedAgentDocuments({ ...facts, knowledgeGraph: artifacts.graph }, references)) {
        const path = `${document.directory}/AGENTS.md`;
        const current = await exists(join(root, path)) ? await readText(join(root, path)) : undefined;
        if (current && !current.startsWith(GENERATED_MARKER)) continue;
        generatedMarkdown.push(path);
        const expected = `${GENERATED_MARKER}\n${document.markdown.trim()}\n`;
        if (current !== expected) drift.push({ severity: "error", category: "guidance", message: `${path} differs from canonical stored facts; run \`harnessme sync\`.` });
      }
      for (const document of artifacts.documents) {
        if (document.path.endsWith(".md")) generatedMarkdown.push(document.path);
        const path = join(root, document.path);
        const expected = document.markdown.endsWith("\n") ? document.markdown : `${document.markdown}\n`;
        if (!await exists(path) || await readText(path) !== expected) drift.push({ severity: "error", category: "graph", message: `${document.path} differs from canonical graph facts; run \`harnessme sync\`.` });
      }
    } catch (error) {
      drift.push({ severity: "error", category: "graph", message: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const issue of await auditGuidanceLinks(root, generatedMarkdown)) {
    drift.push({ severity: "error", category: "guidance", message: `${issue.source} links to missing or out-of-repository target ${issue.target}.` });
  }
  return drift;
}

export default defineCommand({
  meta: { name: "scan", description: "Analyze current code and report drift without writing" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const progress = createProgress(3);
    const drift = await scan(projectRoot(args.root), (message) => progress.step(message));
    progress.done("Scan complete");
    if (!drift.length) return info("No harness drift detected.");
    info(`Detected ${drift.length} drift item(s):`);
    for (const item of drift) info(`- [${item.severity}] ${item.category}: ${item.message}`);
  },
});
