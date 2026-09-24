import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import * as toml from "@iarna/toml";
import {
  atomicWrite,
  exists,
  readFacts,
  readText,
  writeYaml,
  writeJson,
  writeCriticalManifest,
  createKnowledgeArtifacts,
  defaultFeatureOverrides,
  defaultFeaturePack,
  GENERATED_FEATURE_MARKER,
} from "@harnessme/core";
import { isTestPath } from "../../core/src/risk.js";
import { GENERATED_MARKER, extractPending, renderEntrypointMd } from "./agents-md.js";
import { resolveProviders } from "./providers.js";
import { applyRuler } from "./ruler.js";
import { renderGovernance } from "./governance.js";
import { referenceDocuments } from "./reference-pack.js";
import { syncGuidance } from "./guidance/sync.js";
import { captureGeneration } from "./generation-history.js";
import { renderClaudeDesktopInstructions } from "./non-coding-client.js";

export interface SyncResult {
  files: string[];
  targets: string[];
}

function prAgentInstructions(): string {
  return [
    "Review changes against the repository instructions in AGENTS.md.",
    "Prioritize regressions in public contracts, security, persistence, deployment, and shared-core behavior; base findings on the pull request diff and concrete repository evidence, not speculative style concerns.",
    "Apply the active critical-path policy in AGENTS.md and .harnessme/CRITICAL.md. For a changed critical path, verify that its approved record, CRITICAL.md, and critical.json ship with the change; flag a missing or mismatched governance artifact as a high-confidence finding.",
  ].map((instruction) => `- ${instruction}`).join("\n");
}

async function renderPrAgentConfig(root: string): Promise<string> {
  const relative = ".pr_agent.toml";
  const path = join(root, relative);
  let settings = toml.parse("");
  if (await exists(path)) {
    try {
      const parsed = toml.parse(await readText(path));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      settings = parsed;
    } catch {
      throw new Error(`Cannot merge HarnessME PR-Agent settings into invalid TOML: ${relative}`);
    }
  }
  const reviewer = settings.pr_reviewer;
  if (reviewer !== undefined && (!reviewer || typeof reviewer !== "object" || Array.isArray(reviewer))) {
    throw new Error("Cannot merge HarnessME PR-Agent settings into invalid TOML table: [pr_reviewer]");
  }
  settings.pr_reviewer = { ...(reviewer as ReturnType<typeof toml.parse> | undefined), extra_instructions: prAgentInstructions() };
  const header = [
    "# HarnessME-managed PR-Agent review instructions.",
    "# This optional integration is generated only when `harnessme init --targets codex,pr-agent` is selected.",
    "# PR-Agent loads this repository-local configuration from the default branch.",
    "",
  ].join("\n");
  await atomicWrite(path, `${header}${toml.stringify(settings)}`);
  return relative;
}

export async function syncHarness(root: string, targetIds?: string[], options: { archive?: boolean } = {}): Promise<SyncResult> {
  const archive = options.archive !== false;
  if (archive) await captureGeneration(root, "before-sync");
  const facts = await readFacts(root);
  const selected = resolveProviders(targetIds?.length ? targetIds : facts.config.targets);
  const agentsPath = join(root, "AGENTS.md");
  let pending = "";
  if (await exists(agentsPath)) {
    const current = await readText(agentsPath);
    pending = extractPending(current);
    if (!current.startsWith(GENERATED_MARKER)) {
      throw new Error("Refusing to overwrite an AGENTS.md not managed by HarnessME. Import it with `harnessme init` first.");
    }
    await unlink(agentsPath);
  }
  const content = renderEntrypointMd(facts, pending);
  const rulerDir = join(root, ".ruler");
  await mkdir(rulerDir, { recursive: true });
  const rulerAgentsPath = join(rulerDir, "AGENTS.md");
  if (await exists(rulerAgentsPath)) {
    const rulerSource = await readText(rulerAgentsPath);
    if (!rulerSource.startsWith(GENERATED_MARKER)) {
      throw new Error("Refusing to overwrite .ruler/AGENTS.md because HarnessME does not manage it.");
    }
  }
  await atomicWrite(rulerAgentsPath, content);
  const rulerConfigPath = join(rulerDir, "ruler.toml");
  if (!await exists(rulerConfigPath)) {
    await atomicWrite(rulerConfigPath, "# HarnessME uses this directory as Ruler's generated input.\n");
  }

  if (facts.config.distribution.backend === "ruler") {
    await applyRuler(root, selected);
  }
  await atomicWrite(agentsPath, content);
  const files = ["AGENTS.md", ".ruler/AGENTS.md", ".ruler/ruler.toml"];
  await writeCriticalManifest(root, facts.criticalPaths);
  files.push(".harnessme/critical.json");
  const references = referenceDocuments(facts);

  const structure = facts.structure ?? {
    schemaVersion: 1 as const,
    generatedAt: facts.stack.generatedAt,
    files: (facts.stack.sourcePaths ?? []).map((path) => ({ path, kind: isTestPath(path) ? "test" as const : "source" as const })),
    imports: [],
    documents: facts.stack.documentationPaths ?? [],
  };
  const knowledge = createKnowledgeArtifacts({
    structure,
    features: facts.featurePack ?? defaultFeaturePack(structure.generatedAt),
    references: { schemaVersion: 1, generatedAt: facts.referencePack?.generatedAt ?? structure.generatedAt, documents: references },
    criticalPaths: facts.criticalPaths,
    overrides: facts.featureOverrides ?? defaultFeatureOverrides(),
    referenceProvenance: facts.generation?.status === "ai-reviewed" ? "ai-reviewed" : "deterministic",
  });
  const contextFacts = {
    ...facts,
    knowledgeGraph: knowledge.graph,
    referencePack: { schemaVersion: 1 as const, generatedAt: facts.referencePack?.generatedAt ?? structure.generatedAt, documents: references },
  };
  files.push(...await syncGuidance(root, contextFacts, references));
  await writeJson(join(root, ".harnessme", "knowledge-graph.json"), knowledge.graph);
  files.push(".harnessme/knowledge-graph.json");
  const retiredGraphPath = join(root, ".harnessme", "graph.html");
  if (await exists(retiredGraphPath) && (await readText(retiredGraphPath)).includes("<title>HarnessME · 3D Knowledge Graph</title>")) {
    await unlink(retiredGraphPath);
  }
  const featureDir = join(root, ".harnessme", "features");
  await mkdir(featureDir, { recursive: true });
  const expectedFeatures = new Set(knowledge.documents.filter((document) => document.path.startsWith(".harnessme/features/")).map((document) => document.path.split("/").at(-1)));
  for (const entry of await readdir(featureDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || expectedFeatures.has(entry.name)) continue;
    const path = join(featureDir, entry.name);
    const content = await readText(path);
    if (content.startsWith(GENERATED_FEATURE_MARKER) || content.startsWith(GENERATED_MARKER)) await unlink(path);
  }
  for (const document of knowledge.documents) {
    await atomicWrite(join(root, document.path), document.markdown.endsWith("\n") ? document.markdown : `${document.markdown}\n`);
    files.push(document.path);
  }

  if (selected.some((provider) => provider.id === "claude-code")) {
    await atomicWrite(
      join(root, "CLAUDE.md"),
      `${GENERATED_MARKER}\n@AGENTS.md\n`,
    );
    files.push("CLAUDE.md");
  }
  if (selected.some((provider) => provider.id === "claude-desktop")) {
    const desktopPath = ".harnessme/integrations/claude-desktop.md";
    await atomicWrite(join(root, desktopPath), renderClaudeDesktopInstructions());
    files.push(desktopPath);
  }
  if (selected.some((provider) => provider.id === "pr-agent")) {
    files.push(await renderPrAgentConfig(root));
  }
  if (selected.some((provider) => provider.id === "gemini-cli")) {
    const geminiPath = join(root, ".gemini", "settings.json");
    let settings: Record<string, unknown> = {};
    if (await exists(geminiPath)) {
      try {
        settings = JSON.parse(await readText(geminiPath)) as Record<string, unknown>;
      } catch {
        throw new Error("Cannot merge HarnessME settings into invalid JSON: .gemini/settings.json");
      }
    }
    settings.context = { ...((settings.context as object | undefined) ?? {}), fileName: "AGENTS.md" };
    await atomicWrite(geminiPath, `${JSON.stringify(settings, null, 2)}\n`);
    files.push(".gemini/settings.json");
  }

  files.push(...await renderGovernance(
    root,
    facts.criticalPaths,
    selected.some((provider) => provider.id === "claude-code"),
  ));
  for (const provider of selected) {
    if (await exists(join(root, provider.nativeArtifact))) files.push(provider.nativeArtifact);
  }

  // Validate once more at render time so hand-edited fact files fail loudly.
  await writeYaml(join(root, ".harnessme", "harnessme.yaml"), facts.config);
  const result = { files: [...new Set(files)].sort(), targets: selected.map((provider) => provider.id) };
  if (archive) await captureGeneration(root, "sync", result.files);
  return result;
}
