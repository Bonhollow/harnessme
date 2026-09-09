import type { FactsSnapshot, ReferenceDocument } from "@harnessme/core";

export function referenceScopes(reference: ReferenceDocument): string[] {
  return [...new Set(reference.scopes?.length ? reference.scopes : [reference.scope])];
}

export function scopeBase(scope: string): string {
  return scope.replace(/\/\*.*$/u, "").replace(/\/$/u, "");
}

export function scopeMatchesPath(scope: string, path: string): boolean {
  const base = scopeBase(scope);
  return scope === "**/*" || path === base || path.startsWith(`${base}/`);
}

export function groundedScopes(reference: ReferenceDocument, facts: FactsSnapshot): boolean {
  const paths = [...facts.stack.sourcePaths ?? [], ...facts.stack.documentationPaths ?? []];
  return referenceScopes(reference).every((scope) =>
    scope === "**/*" || paths.some((path) => scopeMatchesPath(scope, path)));
}
