import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "citty";
import {
  assessHarnessQuality,
  atomicWrite,
  classifyRisk,
  exists,
  harnessDir,
  readFacts,
  recordQualitySnapshot,
  writeFacts,
  writeJson,
  writeYaml,
  type FactsSnapshot,
  createKnowledgeArtifacts,
  defaultFeatureOverrides,
  defaultFeaturePack,
} from "@harnessme/core";
import { analyzeProject, authorHarnessWithAi, criticalCandidates } from "@harnessme/analyzers";
import { referenceDocuments, renderAgentsMd, syncHarness } from "@harnessme/renderers";
import { createProgress, info, warn } from "../output.js";
import { projectRoot } from "../project.js";

async function removeIfPresent(path: string): Promise<void> {
  if (await exists(path)) await unlink(path);
}

export default defineCommand({
  meta: { name: "refresh", description: "Reanalyze the repository and refresh generated harness guidance" },
  args: {
    deterministic: { type: "boolean", description: "Refresh with deterministic analysis only" },
    details: { type: "string", description: "Optional maintainer context for the refreshed harness (domain rules, constraints, or risks)" },
    "extra-prompt": { type: "string", description: "Deprecated alias for --details" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const base = harnessDir(root);
    const previous = await readFacts(root);
    const suppliedDetails = [args.details, args.extraPrompt]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map((value) => value.trim());
    if (suppliedDetails.length) {
      previous.directives = `${previous.directives.trimEnd()}\n\n## ${new Date().toISOString().slice(0, 10)} — Maintainer project context\n\n${suppliedDetails.join("\n\n")}\n`;
    }
    const progress = createProgress(previous.config.analysis.aiFallback && !args.deterministic ? 7 : 5);
    progress.step("Loading maintainer directives, approvals, and pending updates");
    progress.step("Reanalyzing source, documentation, configuration, and history");
    const analysis = await analyzeProject({
      root,
      ...previous.config.analysis,
      aiFallback: args.deterministic ? undefined : previous.config.analysis.aiFallback,
      review: args.deterministic ? undefined : previous.config.analysis.review,
    });
    for (const message of analysis.warnings) warn(message);
    progress.step("Refreshing evidence, conflicts, and risk candidates");

    const refreshingWithAi = Boolean(previous.config.analysis.aiFallback && !args.deterministic);
    const criticalPaths = {
      ...previous.criticalPaths,
      paths: previous.criticalPaths.paths.filter((entry) =>
        entry.source === "explicit"
        || (entry.status === "active" && (!refreshingWithAi || entry.source === "heuristic"))
      ),
    };
    const approvers = [...new Set(previous.criticalPaths.paths.flatMap((entry) => entry.approvers))];
    const defaultApprovers = approvers.length ? approvers : ["developer"];
    if (criticalPaths.heuristics.enabled) {
      for (const candidate of analysis.hotspots.filter((item) =>
        item.changes >= criticalPaths.heuristics.minChanges
        || item.fanIn >= criticalPaths.heuristics.minFanIn
        || item.score >= criticalPaths.heuristics.minScore
      )) {
        if (criticalPaths.paths.some((entry) => entry.glob === candidate.path)) continue;
        criticalPaths.paths.push({
          glob: candidate.path,
          reason: `Automatically detected core/hotspot (${candidate.changes} changes, ${candidate.fanIn} inbound imports, score ${candidate.score}).`,
          approvers: defaultApprovers,
          source: "heuristic",
          status: "proposed",
          risk: classifyRisk(candidate.path),
        });
      }
      for (const candidate of criticalCandidates(analysis.sourceFiles)) {
        if (criticalPaths.paths.some((entry) => entry.glob === candidate.path)) continue;
        criticalPaths.paths.push({
          glob: candidate.path,
          reason: candidate.reason,
          approvers: defaultApprovers,
          source: "heuristic",
          status: "proposed",
          risk: candidate.risk,
        });
      }
    }
    previous.config.languages = analysis.stack.languages.map((language) => language.name);

    let authoredResult: Awaited<ReturnType<typeof authorHarnessWithAi>> | undefined;
    if (previous.config.analysis.aiFallback && !args.deterministic) {
      const snapshot: FactsSnapshot = {
        config: previous.config,
        conventions: analysis.conventions,
        stack: analysis.stack,
        evidence: analysis.evidence,
        architecture: analysis.architecture,
        directives: previous.directives,
        criticalPaths,
        changes: previous.changes,
        documentationConflicts: analysis.documentationConflicts,
      };
      authoredResult = await authorHarnessWithAi({
        facts: snapshot,
        analysis,
        deterministicBaseline: renderAgentsMd(snapshot),
        inference: previous.config.analysis.aiFallback,
        review: previous.config.analysis.review,
        councilSize: previous.config.analysis.councilSize,
        previousHarness: previous.authoredInstructions,
        previousReferences: previous.referencePack?.documents,
        previousFeatures: previous.featurePack?.features,
        onPhase: (message) => progress.step(message),
      });
      for (const gate of authoredResult.gates) {
        const existing = criticalPaths.paths.find((entry) => entry.glob === gate.path);
        if (existing) {
          existing.reason = gate.reason;
          existing.source = "ai-reviewed";
          existing.status = "active";
          existing.risk = gate.risk;
        } else {
          criticalPaths.paths.push({
            glob: gate.path,
            reason: gate.reason,
            approvers: defaultApprovers,
            source: "ai-reviewed",
            status: "active",
            risk: gate.risk,
          });
        }
      }
    } else {
      progress.step("Rendering refreshed deterministic guidance");
    }

    // Validate the complete candidate graph before replacing any analyzed facts.
    // This keeps stale maintainer overrides from leaving a mixed old/new snapshot.
    const candidateFeaturePack = {
      schemaVersion: 1 as const,
      generatedAt: analysis.structure?.generatedAt ?? new Date().toISOString(),
      features: authoredResult?.features ?? [],
    };
    if (analysis.structure) {
      const candidateSnapshot: FactsSnapshot = {
        ...previous,
        conventions: analysis.conventions,
        stack: analysis.stack,
        evidence: analysis.evidence,
        architecture: analysis.architecture,
        criticalPaths,
        structure: analysis.structure,
        featurePack: candidateFeaturePack,
        authoredInstructions: authoredResult?.markdown,
        referencePack: authoredResult ? { schemaVersion: 1, generatedAt: analysis.structure.generatedAt, documents: authoredResult.references } : undefined,
        generation: { status: authoredResult ? "ai-reviewed" : "deterministic", generatedAt: analysis.structure.generatedAt, activatedGates: authoredResult?.gates ?? [] },
        documentationConflicts: analysis.documentationConflicts,
      };
      const documents = authoredResult?.references ?? referenceDocuments(candidateSnapshot);
      createKnowledgeArtifacts({
        structure: analysis.structure,
        features: candidateFeaturePack,
        references: { schemaVersion: 1, generatedAt: analysis.structure.generatedAt, documents },
        criticalPaths,
        overrides: previous.featureOverrides ?? defaultFeatureOverrides(),
        referenceProvenance: authoredResult ? "ai-reviewed" : "deterministic",
      });
    }

    if (suppliedDetails.length) await atomicWrite(join(base, "facts", "directives.md"), previous.directives);
    await writeFacts(root, analysis);
    await writeYaml(join(base, "critical-paths.yaml"), criticalPaths);
    await writeYaml(join(base, "harnessme.yaml"), previous.config);
    if (authoredResult) {
      await atomicWrite(join(base, "facts", "AGENTS.authored.md"), authoredResult.markdown);
      await writeJson(join(base, "facts", "references.json"), {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        documents: authoredResult.references,
      });
      await writeJson(join(base, "facts", "features.json"), {
        schemaVersion: 1,
        generatedAt: analysis.structure?.generatedAt ?? new Date().toISOString(),
        features: authoredResult.features,
      });
      await writeJson(join(base, "facts", "harness-generation.json"), {
        status: "ai-reviewed",
        generatedAt: new Date().toISOString(),
        authorProvider: authoredResult.authorRuntime,
        authorModel: previous.config.analysis.aiFallback?.model ?? "provider-default",
        reviewerProvider: authoredResult.reviewerRuntime,
        reviewerModel: previous.config.analysis.review?.model ?? previous.config.analysis.aiFallback?.model ?? "provider-default",
        comparison: authoredResult.comparison,
        passes: ["evidence-extraction", "claim-verification", "harness-and-reference-authorship", "baseline-comparison"],
        activatedGates: authoredResult.gates,
      });
    } else {
      await removeIfPresent(join(base, "facts", "AGENTS.authored.md"));
      await removeIfPresent(join(base, "facts", "references.json"));
      await writeJson(join(base, "facts", "features.json"), {
        schemaVersion: 1,
        generatedAt: analysis.structure?.generatedAt ?? new Date().toISOString(),
        features: [],
      });
      await writeJson(join(base, "facts", "harness-generation.json"), {
        status: "deterministic",
        generatedAt: new Date().toISOString(),
        activatedGates: [],
      });
    }

    let refreshed = await readFacts(root);
    if (!refreshed.referencePack) {
      await writeJson(join(base, "facts", "references.json"), {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        documents: referenceDocuments(refreshed),
      });
      refreshed = await readFacts(root);
    }
    if (refreshed.structure) refreshed.knowledgeGraph = createKnowledgeArtifacts({
      structure: refreshed.structure,
      features: refreshed.featurePack ?? defaultFeaturePack(refreshed.structure.generatedAt),
      references: refreshed.referencePack,
      criticalPaths: refreshed.criticalPaths,
      overrides: refreshed.featureOverrides ?? defaultFeatureOverrides(),
      referenceProvenance: refreshed.generation?.status === "ai-reviewed" ? "ai-reviewed" : "deterministic",
    }).graph;
    const quality = assessHarnessQuality(refreshed, analysis.documentationConflicts ?? [], renderAgentsMd(refreshed));
    await writeJson(join(base, "facts", "quality.json"), quality);
    progress.step("Synchronizing agent and governance artifacts");
    const result = await syncHarness(root);
    await recordQualitySnapshot(root, quality, "refresh");
    progress.done("Harness refresh complete");
    info(`Refreshed ${result.files.length} managed artifact(s); maintainer directives, approvals, verified changes, and pending notes were preserved.`);
    info(`Harness quality: ${quality.score}/100.`);
    if (analysis.documentationConflicts?.length) info(`Documentation conflicts requiring review: ${analysis.documentationConflicts.length}.`);
  },
});
