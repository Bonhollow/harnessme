import type { HarnessQuality } from "./schema.js";

export type QualityRemediationWorkflow = "refresh-ai" | "refresh-deterministic" | "features" | "gates";

export interface QualityRemediation {
  id: string;
  title: string;
  dimension: HarnessQuality["dimensions"][number]["id"];
  severity: HarnessQuality["findings"][number]["severity"];
  diagnosis: string;
  action: string;
  workflow: QualityRemediationWorkflow;
  recoverablePoints: number;
  currentScore: number;
  projectedScore: number;
}

const CHECK_TITLES: Record<string, string> = {
  "claim-grounding": "Ground operating claims",
  "evidence-breadth": "Broaden repository evidence",
  "semantic-evidence": "Ground feature relationships",
  "graph-integrity": "Repair graph integrity",
  "semantic-coverage": "Map uncovered files",
  "dependency-density": "Complete dependency mapping",
  "test-linkage": "Connect features to tests",
  purpose: "Define repository purpose",
  "validation-depth": "Strengthen validation guidance",
  "operating-contract": "Complete the operating contract",
  "core-boundaries": "Document core boundaries",
  "workflow-depth": "Deepen change workflows",
  "documentation-discovery": "Route repository documentation",
  "reference-depth": "Deepen scoped guides",
  "documentation-consistency": "Resolve documentation conflicts",
  freshness: "Refresh stale facts",
  "graph-consistency": "Resolve graph diagnostics",
  "critical-review": "Review critical-path proposals",
  "generation-confidence": "Regenerate with reviewed AI",
};

function workflowFor(checkId: string): QualityRemediationWorkflow {
  if (checkId === "critical-review") return "gates";
  if (checkId === "semantic-coverage" || checkId === "test-linkage") return "features";
  if (checkId === "graph-integrity" || checkId === "dependency-density" || checkId === "freshness" || checkId === "graph-consistency") return "refresh-deterministic";
  return "refresh-ai";
}

/** Convert every failed quality check into an ordered, executable remediation plan. */
export function planQualityRemediations(quality: HarnessQuality): QualityRemediation[] {
  return quality.findings
    .filter((finding): finding is typeof finding & { checkId: string } => Boolean(finding.checkId))
    .map((finding) => {
      const recoverablePoints = Math.max(0, finding.recoverablePoints ?? 0);
      return {
        id: finding.checkId,
        title: CHECK_TITLES[finding.checkId] ?? finding.action,
        dimension: finding.dimension,
        severity: finding.severity,
        diagnosis: finding.message,
        action: finding.action,
        workflow: workflowFor(finding.checkId),
        recoverablePoints,
        currentScore: quality.score,
        projectedScore: Math.min(100, Math.round((quality.score + recoverablePoints) * 10) / 10),
      };
    })
    .sort((left, right) => right.recoverablePoints - left.recoverablePoints || left.id.localeCompare(right.id));
}
