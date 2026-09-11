import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readQualityHistory, recordQualitySnapshot, summarizeQualityHistory } from "../packages/core/src/quality-history.js";
import type { HarnessQuality } from "../packages/core/src/schema.js";

function quality(score: number, evidence: number, navigation: number): HarnessQuality {
  return {
    schemaVersion: 1,
    generatedAt: new Date(Date.UTC(2026, 8, 11, 10, score)).toISOString(),
    score,
    grade: score >= 75 ? "strong" : "developing",
    confidence: 90,
    checks: [],
    metrics: [],
    findings: [],
    dimensions: [
      { id: "evidence", label: "Evidence", score: evidence, earned: evidence, maxPoints: 100, summary: "test" },
      { id: "navigation", label: "Navigation", score: navigation, earned: navigation, maxPoints: 100, summary: "test" },
      { id: "operations", label: "Operations", score: 80, earned: 80, maxPoints: 100, summary: "test" },
      { id: "documentation", label: "Documentation", score: 80, earned: 80, maxPoints: 100, summary: "test" },
      { id: "governance", label: "Governance", score: 80, earned: 80, maxPoints: 100, summary: "test" },
    ],
  };
}

describe("quality history", () => {
  it("persists score and dimension trends across quality-changing operations", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-quality-history-"));
    await recordQualitySnapshot(root, quality(62, 50, 55), "init");
    const history = await recordQualitySnapshot(root, quality(78, 70, 85), "refresh");
    expect(await readQualityHistory(root)).toEqual(history);
    expect(summarizeQualityHistory(history)).toEqual(expect.objectContaining({
      snapshots: 2,
      score: 78,
      previousScore: 62,
      delta: 16,
      bestScore: 78,
      lowestScore: 62,
      series: [62, 78],
      dimensionDeltas: expect.objectContaining({ evidence: 20, navigation: 30 }),
    }));
  });

  it("returns no trend before the first recorded assessment", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-quality-history-empty-"));
    expect(summarizeQualityHistory(await readQualityHistory(root))).toBeUndefined();
  });
});
