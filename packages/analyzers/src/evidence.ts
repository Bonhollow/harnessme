import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Convention, Evidence } from "@harnessme/core";

function id(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}-${createHash("sha256").update(parts.join(":"), "utf8").digest("hex").slice(0, 12)}`;
}

export function lineOf(content: string, needle: string): number {
  const index = content.indexOf(needle);
  return index < 0 ? 1 : content.slice(0, index).split(/\r?\n/u).length;
}

export async function readable(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export function addEvidence(all: Evidence[], path: string, line: number, kind: Evidence["kind"], excerpt: string): string {
  const evidenceId = id("ev", path, line, excerpt);
  if (!all.some((item) => item.id === evidenceId)) {
    all.push({ id: evidenceId, path, line: Math.max(1, line), kind, excerpt: excerpt.slice(0, 240) });
  }
  return evidenceId;
}

export function addConvention(
  all: Convention[],
  category: Convention["category"],
  statement: string,
  confidence: number,
  evidence: string[],
): void {
  const factId = id("fact", category, statement);
  if (!all.some((item) => item.id === factId)) all.push({ id: factId, category, statement, confidence, evidence });
}
