import { join } from "node:path";
import { z } from "zod";
import {
  ConventionsSchema,
  CriticalPathsSchema,
  DocumentationConflictSchema,
  EvidenceSchema,
  HarnessConfigSchema,
  HarnessQualitySchema,
  ReferencePackSchema,
  StackSchema,
  VerifiedChangesSchema,
  defaultVerifiedChanges,
  type Conventions,
  type CriticalPaths,
  type DocumentationConflict,
  type Evidence,
  type HarnessConfig,
  type HarnessQuality,
  type ReferencePack,
  type Stack,
  type VerifiedChanges,
} from "./schema.js";
import { atomicWrite, exists, readJson, readText, readYaml, writeJson, writeYaml } from "./files.js";

export interface FactsSnapshot {
  config: HarnessConfig;
  conventions: Conventions;
  stack: Stack;
  evidence: Evidence[];
  architecture: string;
  directives: string;
  criticalPaths: CriticalPaths;
  changes: VerifiedChanges;
  authoredInstructions?: string;
  referencePack?: ReferencePack;
  quality?: HarnessQuality;
  documentationConflicts?: DocumentationConflict[];
}

export const harnessDir = (root: string): string => join(root, ".harnessme");

export async function writeFacts(
  root: string,
  data: Pick<FactsSnapshot, "conventions" | "stack" | "evidence" | "architecture"> & {
    aiInputs?: Array<{ path: string; bytes: number; redactedLines: number }>;
    documentationConflicts?: DocumentationConflict[];
  },
): Promise<void> {
  const facts = join(harnessDir(root), "facts");
  ConventionsSchema.parse(data.conventions);
  StackSchema.parse(data.stack);
  z.array(EvidenceSchema).parse(data.evidence);
  await Promise.all([
    writeYaml(join(facts, "conventions.yaml"), data.conventions),
    writeYaml(join(facts, "stack.yaml"), data.stack),
    writeJson(join(facts, "evidence.json"), data.evidence),
    atomicWrite(join(facts, "architecture.md"), data.architecture),
    ...(data.aiInputs ? [writeJson(join(facts, "ai-inputs.json"), {
      generatedAt: new Date().toISOString(),
      files: data.aiInputs,
    })] : []),
    ...(data.documentationConflicts ? [writeJson(join(facts, "conflicts.json"), data.documentationConflicts)] : []),
  ]);
}

export async function readFacts(root: string): Promise<FactsSnapshot> {
  const base = harnessDir(root);
  const facts = join(base, "facts");
  const changesPath = join(facts, "changes.yaml");
  const authoredPath = join(facts, "AGENTS.authored.md");
  const referencesPath = join(facts, "references.json");
  const qualityPath = join(facts, "quality.json");
  const conflictsPath = join(facts, "conflicts.json");
  const snapshot = {
    config: await readYaml(join(base, "harnessme.yaml"), HarnessConfigSchema),
    conventions: await readYaml(join(facts, "conventions.yaml"), ConventionsSchema),
    stack: await readYaml(join(facts, "stack.yaml"), StackSchema),
    evidence: await readJson(join(facts, "evidence.json"), z.array(EvidenceSchema)),
    architecture: await readText(join(facts, "architecture.md")),
    directives: await readText(join(facts, "directives.md")),
    criticalPaths: await readYaml(join(base, "critical-paths.yaml"), CriticalPathsSchema),
    changes: await exists(changesPath)
      ? await readYaml(changesPath, VerifiedChangesSchema)
      : defaultVerifiedChanges(),
    authoredInstructions: await exists(authoredPath) ? await readText(authoredPath) : undefined,
    referencePack: await exists(referencesPath) ? await readJson(referencesPath, ReferencePackSchema) : undefined,
    quality: await exists(qualityPath) ? await readJson(qualityPath, HarnessQualitySchema) : undefined,
    documentationConflicts: await exists(conflictsPath) ? await readJson(conflictsPath, z.array(DocumentationConflictSchema)) : undefined,
  };
  const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
  for (const fact of snapshot.conventions.facts) {
    const missing = fact.evidence.filter((id) => !evidenceIds.has(id));
    if (missing.length) {
      throw new Error(`Fact ${fact.id} references missing evidence: ${missing.join(", ")}`);
    }
  }
  for (const change of snapshot.changes.changes) {
    const missing = change.evidence.filter((id) => !evidenceIds.has(id));
    if (missing.length) throw new Error(`Verified change ${change.id} references missing evidence: ${missing.join(", ")}`);
  }
  return snapshot;
}

export async function writeVerifiedChanges(root: string, changes: VerifiedChanges): Promise<void> {
  VerifiedChangesSchema.parse(changes);
  await writeYaml(join(harnessDir(root), "facts", "changes.yaml"), changes);
}
