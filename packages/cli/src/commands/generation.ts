import { defineCommand } from "citty";
import { listGenerations, previewGenerationRollback, previewHarnessSync, rollbackGeneration, type GenerationChange } from "@harnessme/renderers";
import { info } from "../output.js";
import { projectRoot, providerValues } from "../project.js";

function printChanges(changes: GenerationChange[]): void {
  if (!changes.length) return info("No generated-document changes detected.");
  for (const change of changes) info(`${change.status.toUpperCase()} ${change.path}  +${change.additions} -${change.deletions}`);
}

const list = defineCommand({
  meta: { name: "list", description: "List archived harness generations" },
  args: { root: { type: "string", description: "Repository root", valueHint: "path" } },
  async run({ args }) {
    const generations = await listGenerations(projectRoot(args.root));
    if (!generations.length) return info("No archived harness generations exist yet.");
    for (const generation of generations) info(`${generation.id}\t${generation.reason}\t${generation.files} files\t${generation.createdAt}`);
  },
});

const preview = defineCommand({
  meta: { name: "preview", description: "Preview generated-document changes without writing" },
  args: {
    targets: { type: "string", description: "Override configured output targets for this preview" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    info("Generated-document preview:");
    printChanges(await previewHarnessSync(projectRoot(args.root), providerValues(args.targets)));
  },
});

const rollback = defineCommand({
  meta: { name: "rollback", description: "Restore an archived harness generation" },
  args: {
    id: { type: "positional", description: "Generation identifier; defaults to the previous generation", required: false },
    preview: { type: "boolean", description: "Show rollback changes without writing" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const result = args.preview
      ? await previewGenerationRollback(root, args.id)
      : await rollbackGeneration(root, args.id);
    info(`${args.preview ? "Rollback preview" : "Restored generation"}: ${result.generation.id}`);
    printChanges(result.changes);
  },
});

export default defineCommand({
  meta: { name: "generation", description: "Preview, inspect, and restore harness generations" },
  subCommands: { list, preview, rollback },
});
