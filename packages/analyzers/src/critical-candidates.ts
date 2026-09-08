import { classifyRisk, type RiskCategory } from "../../core/src/risk.js";

export interface CriticalCandidate {
  path: string;
  risk: RiskCategory;
  reason: string;
}

/** Produces review-only safety candidates from stable, high-impact file names. */
export function criticalCandidates(sourceFiles: string[]): CriticalCandidate[] {
  const seen = new Set<string>();
  const candidates: CriticalCandidate[] = [];
  for (const path of sourceFiles) {
    if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/iu.test(path)) continue;
    const risk = classifyRisk(path);
    if (risk === "other" || seen.has(path)) continue;
    const directSignal = risk !== "shared-core"
      || /(?:^|\/)(?:core|domain|shared)(?:\/|\.|$)/iu.test(path);
    if (!directSignal) continue;
    seen.add(path);
    candidates.push({
      path,
      risk,
      reason: `Detected ${risk.replaceAll("-", " ")} seam; review before activating a pre-edit safety gate.`,
    });
  }
  const priority: Record<RiskCategory, number> = {
    security: 0, persistence: 1, billing: 2, "public-contract": 3, deployment: 4, "shared-core": 5, other: 6,
  };
  const specificity = (candidate: CriticalCandidate): number => {
    if (candidate.risk === "security") return /(?:middleware|token.provider|auth.utils)/iu.test(candidate.path) ? 0 : 1;
    if (candidate.risk === "persistence") return /(?:repository|experiment.store|database|(?:^|[\/_.-])db(?:[\/_.-]|$))/iu.test(candidate.path) ? 0 : 1;
    if (candidate.risk === "public-contract") return /(?:routes?|controllers?|api.client|dto)/iu.test(candidate.path) ? 0 : 1;
    return 1;
  };
  const selected: CriticalCandidate[] = [];
  const counts = new Map<RiskCategory, number>();
  for (const candidate of candidates.sort((left, right) =>
    priority[left.risk] - priority[right.risk] || specificity(left) - specificity(right) || left.path.localeCompare(right.path))) {
    if ((counts.get(candidate.risk) ?? 0) >= 3) continue;
    selected.push(candidate);
    counts.set(candidate.risk, (counts.get(candidate.risk) ?? 0) + 1);
  }
  return selected.slice(0, 12);
}
