import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "citty";
import { minimatch } from "minimatch";
import {
  assessHarnessQuality,
  atomicWrite,
  classifyRisk,
  isTestPath,
  exists,
  harnessDir,
  readFacts,
  recordQualitySnapshot,
  writeFacts,
  writeJson,
  writeYaml,
  type FactsSnapshot,
  type FeatureDefinition,
  type RepositoryStructure,
  createKnowledgeArtifacts,
  defaultFeatureOverrides,
  defaultFeaturePack,
} from "@harnessme/core";
import { analyzeProject, authorHarnessWithAi, criticalCandidates, protectedEntryCandidates } from "@harnessme/analyzers";
import { referenceDocuments, renderAgentsMd, syncHarness } from "@harnessme/renderers";
import { createProgress, info, warn } from "../output.js";
import { projectRoot } from "../project.js";

async function removeIfPresent(path: string): Promise<void> {
  if (await exists(path)) await unlink(path);
}

function retainedFeature(feature: FeatureDefinition, before: RepositoryStructure, after: RepositoryStructure): boolean {
  const inScope = (path: string): boolean => feature.scopes.some((scope) =>
    path === scope.replace(/\/$/u, "") || minimatch(path, scope.endsWith("/") ? `${scope}**` : scope, { dot: true }));
  const source = (structure: RepositoryStructure) => structure.files.filter((file) => file.kind === "source" && inScope(file.path))
    .map((file) => `${file.path}:${file.sha256 ?? ""}`).sort();
  const oldSource = source(before);
  const newSource = source(after);
  if (!oldSource.length || oldSource.length !== newSource.length
    || oldSource.some((entry, index) => !entry.split(":").at(-1) || entry !== newSource[index])) return false;
  const oldFiles = new Map(before.files.map((file) => [file.path, file.sha256]));
  const newFiles = new Map(after.files.map((file) => [file.path, file.sha256]));
  const stableCitation = (path: string): boolean => {
    const oldHash = oldFiles.get(path) ?? before.documentDigests?.[path];
    const newHash = newFiles.get(path) ?? after.documentDigests?.[path];
    return Boolean(oldHash && oldHash === newHash);
  };
  return feature.citations.every((citation) => stableCitation(citation.path))
    && feature.relationships.every((relation) => relation.citations.every((citation) => stableCitation(citation.path)));
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

    const lastReview = new Map(previous.criticalPaths.reviews?.map((review) => [review.glob, review]) ?? []);
    const criticalPaths = {
      ...previous.criticalPaths,
      paths: previous.criticalPaths.paths.map((entry) => {
        const review = lastReview.get(entry.glob);
        return review?.decision === "activate" && entry.status === "proposed"
          ? { ...entry, status: "active" as const, reason: review.reason }
          : entry;
      }).filter((entry) => entry.source === "explicit" || entry.status === "active"),
    };
    const approvers = [...new Set(previous.criticalPaths.paths.flatMap((entry) => entry.approvers))];
    const defaultApprovers = approvers.length ? approvers : ["developer"];
    if (criticalPaths.heuristics.enabled) {
      for (const candidate of analysis.hotspots.filter((item) =>
        !isTestPath(item.path) && (
          item.changes >= criticalPaths.heuristics.minChanges
          || item.fanIn >= criticalPaths.heuristics.minFanIn
          || item.score >= criticalPaths.heuristics.minScore
        )
      )) {
        if (criticalPaths.dismissed?.includes(candidate.path)) continue;
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
        if (criticalPaths.dismissed?.includes(candidate.path)) continue;
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
    for (const candidate of await protectedEntryCandidates(root, analysis.sourceFiles, previous.directives)) {
      criticalPaths.dismissed = criticalPaths.dismissed?.filter((path) => path !== candidate.path);
      const existing = criticalPaths.paths.find((entry) => entry.glob === candidate.path);
      if (existing?.source === "explicit") continue;
      const rule = { glob: candidate.path, reason: candidate.reason, approvers: defaultApprovers, source: "explicit" as const, status: "active" as const, risk: candidate.risk };
      if (existing) Object.assign(existing, rule);
      else criticalPaths.paths.push(rule);
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
        if (criticalPaths.dismissed?.includes(gate.path)) continue;
        const existing = criticalPaths.paths.find((entry) => entry.glob === gate.path);
        if (existing) {
          if (existing.status === "active") continue;
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
    const previousFiles = previous.structure?.files.map((file) => `${file.path}:${file.sha256 ?? ""}`).sort();
    const currentFiles = analysis.structure?.files.map((file) => `${file.path}:${file.sha256 ?? ""}`).sort();
    const previousDocuments = Object.entries(previous.structure?.documentDigests ?? {}).sort(([left], [right]) => left.localeCompare(right));
    const currentDocuments = Object.entries(analysis.structure?.documentDigests ?? {}).sort(([left], [right]) => left.localeCompare(right));
    const analyzedInputsUnchanged = Boolean(previousFiles && currentFiles
      && previousFiles.length === currentFiles.length
      && previousFiles.every((file, index) => file === currentFiles[index])
      && previousDocuments.length === currentDocuments.length
      && previousDocuments.every(([path, digest], index) => path === currentDocuments[index]?.[0] && digest === currentDocuments[index]?.[1]));
    const previousFeatures = previous.featurePack?.features ?? [];
    const authoredFeatures = authoredResult?.features ?? [];
    const selectedFeatures = analyzedInputsUnchanged && previousFeatures.length > authoredFeatures.length
      ? previousFeatures
      : [
        ...authoredFeatures,
        ...previousFeatures.filter((feature) => analysis.structure && previous.structure
          && !authoredFeatures.some((current) => current.slug === feature.slug)
          && retainedFeature(feature, previous.structure, analysis.structure)),
      ].slice(0, 20);
    const selectedSlugs = new Set(selectedFeatures.map((feature) => feature.slug));
    const validatedFeatures = selectedFeatures.map((feature) => ({
      ...feature,
      relationships: feature.relationships.filter((relation) => selectedSlugs.has(relation.to)),
    }));
    const droppedFeatures = previousFeatures.filter((feature) => !selectedSlugs.has(feature.slug));
    if (droppedFeatures.length) warn(`Dropped ${droppedFeatures.length} feature definition(s) without matching replacements; review navigation coverage: ${droppedFeatures.map((feature) => feature.slug).join(", ")}`);
    const candidateFeaturePack = {
      schemaVersion: 1 as const,
      generatedAt: analysis.structure?.generatedAt ?? new Date().toISOString(),
      features: validatedFeatures,
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
        features: validatedFeatures,
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
        features: validatedFeatures,
      });
      await writeJson(join(base, "facts", "harness-generation.json"), {
        status: "deterministic",
        generatedAt: new Date().toISOString(),
        activatedGates: [],
      });
    }

    let refreshed = await readFacts(root);
    if (!refreshed.referencePack?.documents.length) {
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
