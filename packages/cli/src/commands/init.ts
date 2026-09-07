import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand } from "citty";
import {
  atomicWrite,
  defaultConfig,
  defaultCriticalPaths,
  defaultVerifiedChanges,
  exists,
  harnessDir,
  readText,
  writeJson,
  writeFacts,
  writeVerifiedChanges,
  writeYaml,
  type AiReviewConfig,
  type FactsSnapshot,
} from "@harnessme/core";
import {
  analyzeProject,
  authorHarnessWithAi,
  discoverAvailableModels,
  previewAiInputs,
  resolveInferenceProvider,
  type InferenceProviderId,
} from "@harnessme/analyzers";
import { GENERATED_MARKER, providers, renderAgentsMd, resolveProviders, syncHarness } from "@harnessme/renderers";
import { createProgress, disabled, enabled, info, warn } from "../output.js";
import { projectRoot, providerValues } from "../project.js";
import { selectModel } from "../selection.js";

const providerIds = ["auto", "codex", "claude-code", "cursor", "http"] as const;

function normalizeProvider(value: string, option: string): typeof providerIds[number] {
  const normalized = value === "claude" ? "claude-code" : value;
  if (!providerIds.includes(normalized as typeof providerIds[number])) {
    throw new Error(`${option} must be auto, codex, claude-code, cursor, or http.`);
  }
  return normalized as typeof providerIds[number];
}

function frameworkList(provider: typeof providerIds[number]): Array<"codex" | "claude-code" | "cursor"> {
  return provider === "auto"
    ? ["codex", "claude-code", "cursor"]
    : [provider].filter((id): id is "codex" | "claude-code" | "cursor" => ["codex", "claude-code", "cursor"].includes(id));
}

async function resolveModel(
  provider: InferenceProviderId,
  endpoint: string | undefined,
  apiKeyEnv: string | undefined,
  supplied: string | undefined,
): Promise<string | undefined> {
  const discover = !supplied && process.stdin.isTTY && process.stdout.isTTY;
  return selectModel(provider, discover ? await discoverAvailableModels(provider, endpoint, apiKeyEnv) : [], supplied);
}

export default defineCommand({
  meta: { name: "init", description: "Analyze a repository and create its governed agent harness" },
  args: {
    provider: { type: "string", description: "Inference provider: auto, codex, claude-code, cursor, or http", default: "auto" },
    "review-provider": { type: "string", description: "Optional independent fact reviewer: auto, codex, claude-code, cursor, or http" },
    targets: { type: "string", description: "Comma-separated output targets; defaults to every supported framework" },
    "extra-prompt": { type: "string", description: "Maintainer-authored project directive" },
    "critical-approvers": { type: "string", description: "Comma-separated handles for automatically detected critical paths", default: "developer" },
    deterministic: { type: "boolean", description: "Disable model inference and use local deterministic analysis only" },
    "ai-endpoint": { type: "string", description: "Chat-completions endpoint when --provider=http" },
    model: { type: "string", description: "Optional inference model override; otherwise use the framework default" },
    "ai-api-key-env": { type: "string", description: "Environment variable containing the optional endpoint API key", default: "" },
    "ai-include": { type: "string", description: "Comma-separated source globs allowed for model inference", default: "**/*" },
    "ai-exclude": { type: "string", description: "Comma-separated source globs excluded from model inference" },
    "ai-preview": { type: "boolean", description: "List files selected for model inference, then exit without writing" },
    "review-ai-endpoint": { type: "string", description: "Chat-completions endpoint when --review-provider=http" },
    "review-model": { type: "string", description: "Optional independent reviewer model override" },
    "review-ai-api-key-env": { type: "string", description: "Environment variable containing the optional reviewer endpoint API key", default: "" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const base = harnessDir(root);
    if (await exists(base)) {
      throw new Error(`HarnessME is already initialized at ${root}. Use \`harnessme scan\` or \`harnessme sync\`.`);
    }
    const selected = resolveProviders(providerValues(args.targets) ?? providers.map((provider) => provider.id));
    const config = defaultConfig(selected.map((provider) => provider.id));
    if (!args.deterministic) {
      const requestedProvider = normalizeProvider(String(args.provider), "--provider");
      const endpoint = typeof args.aiEndpoint === "string" ? args.aiEndpoint : undefined;
      if (requestedProvider === "http" && !endpoint) throw new Error("HTTP inference requires --ai-endpoint.");
      const provisional: AiReviewConfig = {
        provider: requestedProvider,
        frameworks: frameworkList(requestedProvider),
        endpoint,
        model: typeof args.model === "string" ? args.model : undefined,
        apiKeyEnv: String(args.aiApiKeyEnv),
      };
      const resolvedProvider = await resolveInferenceProvider(provisional);
      if (!resolvedProvider) {
        if (requestedProvider !== "auto") throw new Error(`The selected inference provider is not installed or authenticated: ${requestedProvider}.`);
        disabled("AI-assisted mode unavailable; using deterministic-only generation");
        enabled("Deterministic repository analysis");
      } else {
        const model = await resolveModel(resolvedProvider, endpoint, provisional.apiKeyEnv, provisional.model);
        if (resolvedProvider === "http" && !model) throw new Error("HTTP inference requires --model (or an interactive model selection).");
        config.analysis.aiFallback = {
          enabled: true,
          provider: resolvedProvider,
          frameworks: frameworkList(resolvedProvider),
          endpoint,
          model,
          apiKeyEnv: provisional.apiKeyEnv,
          maxFiles: 20,
          maxFileBytes: 65_536,
          include: String(args.aiInclude).split(",").map((item) => item.trim()).filter(Boolean),
          exclude: typeof args.aiExclude === "string" ? args.aiExclude.split(",").map((item) => item.trim()).filter(Boolean) : [],
        };
        enabled(`AI-assisted mode: ${resolvedProvider} / ${model ?? "provider default"}`);
        enabled("Deterministic repository analysis as the evidence foundation");

        if (typeof args.reviewProvider === "string") {
          const requestedReviewer = normalizeProvider(args.reviewProvider, "--review-provider");
          const reviewEndpoint = typeof args.reviewAiEndpoint === "string" ? args.reviewAiEndpoint : undefined;
          if (requestedReviewer === "http" && !reviewEndpoint) throw new Error("HTTP review inference requires --review-ai-endpoint.");
          const provisionalReview: AiReviewConfig = {
            provider: requestedReviewer,
            frameworks: frameworkList(requestedReviewer),
            endpoint: reviewEndpoint,
            model: typeof args.reviewModel === "string" ? args.reviewModel : undefined,
            apiKeyEnv: String(args.reviewAiApiKeyEnv),
          };
          const resolvedReviewer = await resolveInferenceProvider(provisionalReview);
          if (!resolvedReviewer) throw new Error(`The selected review provider is not installed or authenticated: ${requestedReviewer}.`);
          const reviewModel = await resolveModel(resolvedReviewer, reviewEndpoint, provisionalReview.apiKeyEnv, provisionalReview.model);
          if (resolvedReviewer === "http" && !reviewModel) throw new Error("HTTP review inference requires --review-model (or an interactive model selection).");
          config.analysis.review = {
            ...provisionalReview,
            provider: resolvedReviewer,
            frameworks: frameworkList(resolvedReviewer),
            model: reviewModel,
          };
          enabled(`Independent AI comparison review: ${resolvedReviewer} / ${reviewModel ?? "provider default"}`);
        } else {
          enabled("AI comparison review: separate pass with the selected model");
        }
      }
    } else {
      disabled("AI-assisted mode disabled by --deterministic");
      enabled("Deterministic-only repository analysis and harness generation");
    }
    if (args.aiPreview) {
      if (!config.analysis.aiFallback) throw new Error("--ai-preview requires model inference; remove --deterministic.");
      const previewProgress = createProgress(2);
      previewProgress.step("Inspecting model-inference file selection");
      const preview = await previewAiInputs(root, config.analysis.exclude, config.analysis.aiFallback);
      previewProgress.done("AI input preview complete");
      info(`Model inference would receive ${preview.length} file(s):`);
      for (const item of preview) info(`- ${item.path} (${item.bytes} bytes, ${item.redactedLines} redacted line(s))`);
      return;
    }
    const progress = createProgress(config.analysis.aiFallback ? 8 : 6);
    progress.step("Preparing the HarnessME workspace");
    await mkdir(join(base, "facts"), { recursive: true });
    await mkdir(join(base, "critical-log"), { recursive: true });
    await mkdir(join(base, "skills"), { recursive: true });
    if (!await exists(join(root, ".harnessmeignore"))) {
      await atomicWrite(
        join(root, ".harnessmeignore"),
        "# Additional paths that HarnessME must never send to model inference.\n# Built-in exclusions already cover common keys, credentials, .env files, and secret directories.\n",
      );
    }
    await writeYaml(join(base, "harnessme.yaml"), config);
    const criticalPaths = defaultCriticalPaths();
    const initialChanges = defaultVerifiedChanges();
    await writeYaml(join(base, "critical-paths.yaml"), criticalPaths);
    await writeVerifiedChanges(root, initialChanges);

    progress.step("Preserving existing repository instructions");
    let directives = "# Project directives\n\n";
    const agentsPath = join(root, "AGENTS.md");
    if (await exists(agentsPath)) {
      const existing = await readText(agentsPath);
      if (!existing.startsWith(GENERATED_MARKER)) {
        directives += `## Imported from the pre-existing AGENTS.md\n\n${existing.trim()}\n\n`;
        await atomicWrite(join(base, "imported-AGENTS.md"), existing);
        await unlink(agentsPath);
        info("Imported the pre-existing AGENTS.md as directives and archived the original in .harnessme/imported-AGENTS.md.");
      }
    }
    const rulerAgentsPath = join(root, ".ruler", "AGENTS.md");
    if (await exists(rulerAgentsPath)) {
      const existing = await readText(rulerAgentsPath);
      if (!existing.startsWith(GENERATED_MARKER)) {
        directives += `## Imported from the pre-existing .ruler/AGENTS.md\n\n${existing.trim()}\n\n`;
        await atomicWrite(join(base, "imported-ruler-AGENTS.md"), existing);
        await unlink(rulerAgentsPath);
        info("Imported the pre-existing .ruler/AGENTS.md as directives and archived the original.");
      }
    }
    if (typeof args.extraPrompt === "string") {
      directives += `## ${new Date().toISOString().slice(0, 10)}\n\n${args.extraPrompt.trim()}\n`;
    }
    await atomicWrite(join(base, "facts", "directives.md"), directives);
    await atomicWrite(
      join(base, "CRITICAL.md"),
      "# Critical-path change log\n\nAuto-maintained by HarnessME. Full records are in `.harnessme/critical-log/`.\n\n| Date | Path | Summary | Approved by | Change ID |\n|---|---|---|---|---|\n",
    );

    progress.step("Analyzing source, configuration, dependencies, and history");
    const analysis = await analyzeProject({ root, ...config.analysis });
    progress.step("Saving evidence and critical-path candidates");
    await writeFacts(root, analysis);
    const approvers = String(args.criticalApprovers).split(",").map((item) => item.trim().replace(/^@/u, "")).filter(Boolean);
    if (!approvers.length) throw new Error("--critical-approvers must include at least one handle.");
    if (criticalPaths.heuristics.enabled) {
      for (const candidate of analysis.hotspots.filter((item) =>
        item.changes >= criticalPaths.heuristics.minChanges
        || item.fanIn >= criticalPaths.heuristics.minFanIn
        || item.score >= criticalPaths.heuristics.minScore
      )) {
        criticalPaths.paths.push({
          glob: candidate.path,
          reason: `Automatically detected core/hotspot (${candidate.changes} changes, ${candidate.fanIn} inbound imports, score ${candidate.score}).`,
          approvers,
          source: "heuristic",
          status: "proposed",
        });
      }
      await writeYaml(join(base, "critical-paths.yaml"), criticalPaths);
    }
    config.languages = analysis.stack.languages.map((language) => language.name);
    await writeYaml(join(base, "harnessme.yaml"), config);
    if (config.analysis.aiFallback) {
      const snapshot: FactsSnapshot = {
        config,
        conventions: analysis.conventions,
        stack: analysis.stack,
        evidence: analysis.evidence,
        architecture: analysis.architecture,
        directives,
        criticalPaths,
        changes: initialChanges,
      };
      const authored = await authorHarnessWithAi({
        facts: snapshot,
        analysis,
        deterministicBaseline: renderAgentsMd(snapshot),
        inference: config.analysis.aiFallback,
        review: config.analysis.review,
        onPhase: (message) => progress.step(message),
      });
      for (const gate of authored.gates) {
        const existing = criticalPaths.paths.find((entry) => entry.glob === gate.path);
        if (existing) {
          existing.reason = gate.reason;
          existing.source = "ai-reviewed";
          existing.status = "active";
        } else {
          criticalPaths.paths.push({
            glob: gate.path,
            reason: gate.reason,
            approvers,
            source: "ai-reviewed",
            status: "active",
          });
        }
      }
      await writeYaml(join(base, "critical-paths.yaml"), criticalPaths);
      await atomicWrite(join(base, "facts", "AGENTS.authored.md"), authored.markdown);
      await writeJson(join(base, "facts", "harness-generation.json"), {
        generatedAt: new Date().toISOString(),
        authorProvider: authored.authorRuntime,
        authorModel: config.analysis.aiFallback.model ?? "provider-default",
        reviewerProvider: authored.reviewerRuntime,
        reviewerModel: config.analysis.review?.model ?? config.analysis.aiFallback.model ?? "provider-default",
        comparison: authored.comparison,
        activatedGates: authored.gates,
      });
    } else {
      progress.step("Rendering the deterministic instruction baseline");
    }
    progress.step("Generating instructions and governance integrations");
    const result = await syncHarness(root);
    progress.done("Harness created");
    for (const message of analysis.warnings) warn(message);
    info(`Initialized HarnessME with targets: ${result.targets.join(", ")}.`);
    const activeCount = criticalPaths.paths.filter((entry) => entry.status === "active").length;
    const proposedCount = criticalPaths.paths.filter((entry) => entry.status === "proposed").length;
    info(`Critical paths: ${activeCount} active, ${proposedCount} proposed. Review .harnessme/critical-paths.yaml, then run \`harnessme hooks install\`.`);
    info(`Generated ${result.files.join(", ")}.`);
  },
});
