import { mkdir, readdir, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import type { FactsSnapshot, ReferenceDocument } from "@harnessme/core";
import { atomicWrite, exists, readText } from "@harnessme/core";
import { GENERATED_MARKER } from "../agents-md.js";
import { nestedAgentDocuments } from "./nested-agents.js";

const SKIPPED_DIRECTORIES = new Set([".git", ".harnessme", ".ruler", "node_modules"]);

async function managedNestedAgents(root: string, directory = root): Promise<string[]> {
  const matches: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await managedNestedAgents(root, path));
    } else if (entry.name === "AGENTS.md" && directory !== root && (await readText(path)).startsWith(GENERATED_MARKER)) {
      matches.push(relative(root, path));
    }
  }
  return matches;
}

export async function syncGuidance(
  root: string,
  facts: FactsSnapshot,
  references: ReferenceDocument[],
): Promise<string[]> {
  const files: string[] = [];
  const referencesDir = join(root, ".harnessme", "references");
  await mkdir(referencesDir, { recursive: true });
  const expectedReferences = new Set(references.map((reference) => `${reference.slug}.md`));
  for (const entry of await readdir(referencesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || expectedReferences.has(entry.name)) continue;
    const path = join(referencesDir, entry.name);
    if ((await readText(path)).startsWith(GENERATED_MARKER)) await unlink(path);
  }
  for (const reference of references) {
    const relativePath = `.harnessme/references/${reference.slug}.md`;
    await atomicWrite(join(root, relativePath), `${GENERATED_MARKER}\n${reference.markdown.trim()}\n`);
    files.push(relativePath);
  }

  const nested = nestedAgentDocuments(facts, references);
  const expectedNested = new Set(nested.map((document) => `${document.directory}/AGENTS.md`));
  for (const relativePath of await managedNestedAgents(root)) {
    if (!expectedNested.has(relativePath)) await unlink(join(root, relativePath));
  }
  for (const document of nested) {
    const relativePath = `${document.directory}/AGENTS.md`;
    const absolutePath = join(root, relativePath);
    if (await exists(absolutePath) && !(await readText(absolutePath)).startsWith(GENERATED_MARKER)) continue;
    await atomicWrite(absolutePath, `${GENERATED_MARKER}\n${document.markdown.trim()}\n`);
    files.push(relativePath);
  }
  return files;
}
