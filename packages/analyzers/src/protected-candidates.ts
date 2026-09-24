import { join } from "node:path";
import { classifyRisk, isTestPath } from "../../core/src/risk.js";
import { protectedMethodsDefinedInPython, protectedMethodsFromDirectives } from "../../core/src/directives.js";
import { readable } from "./evidence.js";
import type { CriticalCandidate } from "./critical-candidates.js";

/** Activate only directives whose named Python definition resolves to one source file. */
export async function protectedEntryCandidates(root: string, sourceFiles: string[], directives: string): Promise<Array<CriticalCandidate & { methods: string[] }>> {
  const methods = protectedMethodsFromDirectives(directives);
  if (!methods.length) return [];
  const definitions = new Map<string, string[]>();
  for (const path of sourceFiles.filter((item) => item.endsWith(".py") && !isTestPath(item))) {
    const source = await readable(join(root, path));
    if (!source) continue;
    for (const method of protectedMethodsDefinedInPython(path, source, methods)) {
      definitions.set(method, [...(definitions.get(method) ?? []), path]);
    }
  }
  const byPath = new Map<string, string[]>();
  for (const [method, paths] of definitions) {
    if (paths.length !== 1) continue;
    const path = paths[0]!;
    byPath.set(path, [...(byPath.get(path) ?? []), method]);
  }
  return [...byPath].map(([path, namedMethods]) => {
    const risk = classifyRisk(path);
    return {
      path,
      methods: namedMethods,
      risk: risk === "other" ? "shared-core" : risk,
      reason: `Maintainer directives protect ${namedMethods.map((method) => `\`${method}\``).join(", ")}; obtain their specified approval before editing this file.`,
    };
  });
}
