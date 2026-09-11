import { defineCommand } from "citty";
import { join } from "node:path";
import { createKnowledgeArtifacts, defaultFeatureOverrides, defaultFeaturePack, detectDrift, exists, readFacts, readText } from "@harnessme/core";
import { analyzeProject } from "@harnessme/analyzers";
import { createProgress, info, warn } from "../output.js";
import { projectRoot } from "../project.js";

export async function scan(root: string, onPhase?: (message: string) => void): Promise<ReturnType<typeof detectDrift>> {
  onPhase?.("Loading the committed harness facts");
  const facts = await readFacts(root);
  onPhase?.("Analyzing the current repository");
  const current = await analyzeProject({ root, ...facts.config.analysis });
  for (const message of current.warnings) warn(message);
  const drift = detectDrift(current, facts);
  if (facts.structure && facts.referencePack) {
    try {
      const artifacts = createKnowledgeArtifacts({ structure: facts.structure, features: facts.featurePack ?? defaultFeaturePack(facts.structure.generatedAt), references: facts.referencePack, criticalPaths: facts.criticalPaths, overrides: facts.featureOverrides ?? defaultFeatureOverrides(), referenceProvenance: facts.generation?.status === "ai-reviewed" ? "ai-reviewed" : "deterministic" });
      for (const document of artifacts.documents) {
        const path = join(root, document.path);
        const expected = document.markdown.endsWith("\n") ? document.markdown : `${document.markdown}\n`;
        if (!await exists(path) || await readText(path) !== expected) drift.push({ severity: "error", category: "graph", message: `${document.path} differs from canonical graph facts; run \`harnessme sync\`.` });
      }
    } catch (error) {
      drift.push({ severity: "error", category: "graph", message: error instanceof Error ? error.message : String(error) });
    }
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
