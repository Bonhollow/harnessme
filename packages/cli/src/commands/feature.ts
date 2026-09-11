import { join } from "node:path";
import { defineCommand } from "citty";
import { FeatureOverridesSchema, harnessDir, posixPath, readFacts, writeYaml } from "@harnessme/core";
import { syncHarness } from "@harnessme/renderers";
import { info } from "../output.js";
import { projectRoot } from "../project.js";

function list(value: unknown): string[] {
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function safeScopes(value: unknown): string[] {
  const scopes = list(value).map(posixPath);
  if (!scopes.length) throw new Error("At least one repository-relative scope is required.");
  if (scopes.some((scope) => scope.startsWith("/") || /^[A-Za-z]:\//u.test(scope) || scope.split("/").includes(".."))) throw new Error("Feature scopes must stay inside the repository.");
  return scopes;
}

async function update(root: string, mutate: (overrides: ReturnType<typeof FeatureOverridesSchema.parse>, facts: Awaited<ReturnType<typeof readFacts>>) => void): Promise<void> {
  const facts = await readFacts(root);
  const overrides = FeatureOverridesSchema.parse(facts.featureOverrides ?? { schemaVersion: 1 });
  mutate(overrides, facts);
  const previous = facts.featureOverrides;
  facts.featureOverrides = overrides;
  try {
    // Validate the complete merged graph before changing the maintainer-owned file.
    const { createKnowledgeArtifacts, defaultFeaturePack } = await import("@harnessme/core");
    const structure = facts.structure ?? { schemaVersion: 1 as const, generatedAt: facts.stack.generatedAt, files: (facts.stack.sourcePaths ?? []).map((path) => ({ path, kind: /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)|(?:\.|_)(?:test|spec)\.[^.]+$/iu.test(path) ? "test" as const : "source" as const })), imports: [], documents: facts.stack.documentationPaths ?? [] };
    createKnowledgeArtifacts({ structure, features: facts.featurePack ?? defaultFeaturePack(structure.generatedAt), references: facts.referencePack, criticalPaths: facts.criticalPaths, overrides, referenceProvenance: facts.generation?.status === "ai-reviewed" ? "ai-reviewed" : "deterministic" });
    await writeYaml(join(harnessDir(root), "feature-overrides.yaml"), overrides);
    await syncHarness(root);
  } catch (error) {
    facts.featureOverrides = previous;
    throw error;
  }
}

export const add = defineCommand({
  meta: { name: "add", description: "Add a maintainer-owned feature" },
  args: {
    slug: { type: "positional", required: true, description: "Stable kebab-case feature identifier" },
    title: { type: "string", required: true, description: "Human-readable feature title" },
    summary: { type: "string", required: true, description: "Feature purpose" },
    scopes: { type: "string", required: true, description: "Comma-separated repository paths or globs" },
    responsibilities: { type: "string", description: "Comma-separated responsibilities" },
    invariants: { type: "string", description: "Comma-separated invariants" },
    validation: { type: "string", description: "Comma-separated validation commands" },
    kind: { type: "string", description: "feature or concern", default: "feature" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    await update(root, (overrides) => {
      if (overrides.features.some((item) => item.slug === args.slug)) throw new Error(`Maintainer feature already exists: ${args.slug}`);
      overrides.features.push({ slug: args.slug, kind: args.kind as "feature" | "concern", title: args.title, summary: args.summary, scopes: safeScopes(args.scopes), responsibilities: list(args.responsibilities), invariants: list(args.invariants), validation: list(args.validation), citations: [], relationships: [] });
      overrides.excludedFeatures = overrides.excludedFeatures.filter((item) => item !== args.slug && !item.endsWith(`:${args.slug}`));
    });
    info(`Added feature ${args.slug}; regenerated the knowledge graph and feature guides.`);
  },
});

export const edit = defineCommand({
  meta: { name: "edit", description: "Edit a maintainer feature override" },
  args: {
    slug: { type: "positional", required: true, description: "Feature identifier" },
    title: { type: "string", description: "Replacement title" },
    summary: { type: "string", description: "Replacement summary" },
    scopes: { type: "string", description: "Replacement comma-separated scopes" },
    responsibilities: { type: "string", description: "Replacement comma-separated responsibilities" },
    invariants: { type: "string", description: "Replacement comma-separated invariants" },
    validation: { type: "string", description: "Replacement comma-separated validation commands" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    await update(root, (overrides, facts) => {
      let feature = overrides.features.find((item) => item.slug === args.slug);
      if (!feature) {
        const generated = facts.featurePack?.features.find((item) => item.slug === args.slug);
        if (!generated) throw new Error(`Unknown feature: ${args.slug}`);
        feature = structuredClone(generated);
        overrides.features.push(feature);
      }
      if (typeof args.title === "string") feature.title = args.title;
      if (typeof args.summary === "string") feature.summary = args.summary;
      if (typeof args.scopes === "string") feature.scopes = safeScopes(args.scopes);
      if (typeof args.responsibilities === "string") feature.responsibilities = list(args.responsibilities);
      if (typeof args.invariants === "string") feature.invariants = list(args.invariants);
      if (typeof args.validation === "string") feature.validation = list(args.validation);
      overrides.excludedFeatures = overrides.excludedFeatures.filter((item) => item !== args.slug && !item.endsWith(`:${args.slug}`));
    });
    info(`Updated feature ${args.slug}; regenerated the knowledge graph and feature guides.`);
  },
});

export const remove = defineCommand({
  meta: { name: "remove", description: "Remove or exclude a feature" },
  args: { slug: { type: "positional", required: true, description: "Feature identifier" }, root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const root = projectRoot(args.root);
    await update(root, (overrides, facts) => {
      const known = overrides.features.some((item) => item.slug === args.slug) || facts.featurePack?.features.some((item) => item.slug === args.slug);
      if (!known) throw new Error(`Unknown feature: ${args.slug}`);
      overrides.features = overrides.features.filter((item) => item.slug !== args.slug);
      if (!overrides.excludedFeatures.includes(args.slug)) overrides.excludedFeatures.push(args.slug);
      overrides.relationships = overrides.relationships.filter((item) => item.from !== args.slug && item.to !== args.slug);
    });
    info(`Removed feature ${args.slug}; regenerated the knowledge graph and feature guides.`);
  },
});

export const listFeatures = defineCommand({
  meta: { name: "list", description: "List graph features and concerns" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const facts = await readFacts(projectRoot(args.root));
    const nodes = facts.knowledgeGraph?.nodes.filter((node) => node.kind === "feature" || node.kind === "concern") ?? [];
    if (!nodes.length) return info("No semantic features are registered; deterministic module navigation remains available.");
    for (const node of nodes) info(`${node.kind}\t${node.id.replace(/^[^:]+:/u, "")}\t${node.provenance}\t${node.label}`);
  },
});

async function changeLink(root: string, from: string, to: string, kind: "depends-on" | "related-to", removeLink: boolean): Promise<void> {
  await update(root, (overrides) => {
    const id = `${kind}:${from}->${to}`;
    overrides.relationships = overrides.relationships.filter((item) => !(item.from === from && item.to === to && item.kind === kind));
    if (removeLink) {
      if (!overrides.excludedRelationships.includes(id)) overrides.excludedRelationships.push(id);
    } else {
      overrides.relationships.push({ from, to, kind });
      overrides.excludedRelationships = overrides.excludedRelationships.filter((item) => item !== id);
    }
  });
}

const linkArgs = {
  from: { type: "positional" as const, required: true, description: "Source feature slug" },
  to: { type: "positional" as const, required: true, description: "Target feature slug" },
  kind: { type: "string" as const, default: "depends-on", description: "depends-on or related-to" },
  root: { type: "string" as const, description: "Repository root", valueHint: "path" },
};
export const link = defineCommand({ meta: { name: "link", description: "Link two features" }, args: linkArgs, async run({ args }) { const kind = args.kind as "depends-on" | "related-to"; if (!["depends-on", "related-to"].includes(kind)) throw new Error("Unsupported feature relationship kind."); await changeLink(projectRoot(args.root), String(args.from), String(args.to), kind, false); info(`Linked ${args.from} ${kind} ${args.to}.`); } });
export const unlink = defineCommand({ meta: { name: "unlink", description: "Remove or exclude a feature link" }, args: linkArgs, async run({ args }) { const kind = args.kind as "depends-on" | "related-to"; if (!["depends-on", "related-to"].includes(kind)) throw new Error("Unsupported feature relationship kind."); await changeLink(projectRoot(args.root), String(args.from), String(args.to), kind, true); info(`Unlinked ${args.from} ${kind} ${args.to}.`); } });

export default defineCommand({ meta: { name: "feature", description: "Manage feature-map overrides" }, subCommands: { list: listFeatures, add, edit, remove, link, unlink } });
