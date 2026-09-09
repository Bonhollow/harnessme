import { join } from "node:path";
import { assessHarnessQuality, readFacts, readText, type HarnessQuality } from "@harnessme/core";

export interface QualityReport {
  quality: HarnessQuality;
  generation: string;
  references: number;
  activeGates: number;
  conflicts: number;
}

export async function loadQualityReport(root: string): Promise<QualityReport> {
  const facts = await readFacts(root);
  const quality = assessHarnessQuality(
    facts,
    facts.documentationConflicts ?? [],
    await readText(join(root, "AGENTS.md")),
  );
  return {
    quality,
    generation: facts.generation?.status ?? (facts.config.analysis.aiFallback ? "AI configured" : "deterministic"),
    references: facts.referencePack?.documents.length ?? 0,
    activeGates: facts.criticalPaths.paths.filter((path) => path.status === "active").length,
    conflicts: facts.documentationConflicts?.length ?? 0,
  };
}
