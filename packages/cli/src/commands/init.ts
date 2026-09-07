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
  writeFacts,
  writeVerifiedChanges,
  writeYaml,
} from "@harnessme/core";
import { analyzeProject } from "@harnessme/analyzers";
import { GENERATED_MARKER, providers, resolveProviders, syncHarness } from "@harnessme/renderers";
import { info, warn } from "../output.js";
import { projectRoot, providerValues } from "../project.js";

export default defineCommand({
  meta: { name: "init", description: "Analyze a repository and create its governed agent harness" },
  args: {
    provider: { type: "string", description: "Inference provider: auto, codex, claude-code, cursor, or http", default: "auto" },
    targets: { type: "string", description: "Comma-separated output targets; defaults to every supported framework" },
    "extra-prompt": { type: "string", description: "Maintainer-authored project directive" },
    "critical-approvers": { type: "string", description: "Comma-separated handles for automatically detected critical paths", default: "developer" },
    deterministic: { type: "boolean", description: "Disable model inference and use local deterministic analysis only" },
    "ai-endpoint": { type: "string", description: "Chat-completions endpoint when --provider=http" },
    model: { type: "string", description: "Optional inference model override; otherwise use the framework default" },
    "ai-api-key-env": { type: "string", description: "Environment variable containing the optional endpoint API key", default: "" },
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
      const rawProvider = String(args.provider);
      const inferenceProvider = rawProvider === "claude" ? "claude-code" : rawProvider;
      if (!["auto", "codex", "claude-code", "cursor", "http"].includes(inferenceProvider)) {
        throw new Error("--provider must be auto, codex, claude-code, cursor, or http.");
      }
      const model = typeof args.model === "string" ? args.model : undefined;
      if (inferenceProvider === "http" && (!args.aiEndpoint || !model)) {
        throw new Error("HTTP inference requires --ai-endpoint and --model.");
      }
      config.analysis.aiFallback = {
        enabled: true,
        provider: inferenceProvider as "auto" | "codex" | "claude-code" | "cursor" | "http",
        frameworks: inferenceProvider === "auto"
          ? ["codex", "claude-code", "cursor"]
          : [inferenceProvider].filter((id): id is "codex" | "claude-code" | "cursor" => ["codex", "claude-code", "cursor"].includes(id)),
        endpoint: typeof args.aiEndpoint === "string" ? args.aiEndpoint : undefined,
        model,
        apiKeyEnv: String(args.aiApiKeyEnv),
        maxFiles: 20,
        maxFileBytes: 65_536,
      };
    }
    await mkdir(join(base, "facts"), { recursive: true });
    await mkdir(join(base, "critical-log"), { recursive: true });
    await mkdir(join(base, "skills"), { recursive: true });
    await writeYaml(join(base, "harnessme.yaml"), config);
    const criticalPaths = defaultCriticalPaths();
    await writeYaml(join(base, "critical-paths.yaml"), criticalPaths);
    await writeVerifiedChanges(root, defaultVerifiedChanges());

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

    info(`Analyzing ${root}...`);
    const analysis = await analyzeProject({ root, ...config.analysis });
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
        });
      }
      await writeYaml(join(base, "critical-paths.yaml"), criticalPaths);
    }
    config.languages = analysis.stack.languages.map((language) => language.name);
    await writeYaml(join(base, "harnessme.yaml"), config);
    const result = await syncHarness(root);
    for (const message of analysis.warnings) warn(message);
    info(`Initialized HarnessME with targets: ${result.targets.join(", ")}.`);
    info(`Detected ${criticalPaths.paths.length} critical path candidate(s). Review .harnessme/critical-paths.yaml, then run \`harnessme hooks install\`.`);
    info(`Generated ${result.files.join(", ")}.`);
  },
});
