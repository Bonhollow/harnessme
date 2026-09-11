import { join } from "node:path";
import { z } from "zod";
import { exists, readJson, writeJson } from "./files.js";
import { harnessDir } from "./facts-store.js";
import type { HarnessQuality } from "./schema.js";

const DimensionSnapshotSchema = z.object({
  id: z.enum(["evidence", "navigation", "operations", "documentation", "governance"]),
  score: z.number().int().min(0).max(100),
});

const QualityHistorySchema = z.object({
  schemaVersion: z.literal(1),
  snapshots: z.array(z.object({
    capturedAt: z.string().datetime(),
    trigger: z.enum(["init", "refresh", "remediation"]),
    score: z.number().int().min(0).max(100),
    grade: z.enum(["excellent", "strong", "developing", "weak", "critical"]),
    confidence: z.number().int().min(0).max(100),
    dimensions: z.array(DimensionSnapshotSchema),
  })).max(100),
});

export type QualityHistory = z.infer<typeof QualityHistorySchema>;
export type QualityHistoryTrigger = QualityHistory["snapshots"][number]["trigger"];

export interface QualityTrend {
  snapshots: number;
  score: number;
  previousScore?: number;
  delta: number;
  bestScore: number;
  lowestScore: number;
  dimensionDeltas: Record<QualityHistory["snapshots"][number]["dimensions"][number]["id"], number>;
  series: number[];
}

function historyPath(root: string): string {
  return join(harnessDir(root), "facts", "quality-history.json");
}

export async function readQualityHistory(root: string): Promise<QualityHistory> {
  const path = historyPath(root);
  return await exists(path) ? readJson(path, QualityHistorySchema) : { schemaVersion: 1, snapshots: [] };
}

export async function recordQualitySnapshot(root: string, quality: HarnessQuality, trigger: QualityHistoryTrigger): Promise<QualityHistory> {
  const history = await readQualityHistory(root);
  history.snapshots.push({
    capturedAt: quality.generatedAt,
    trigger,
    score: quality.score,
    grade: quality.grade,
    confidence: quality.confidence,
    dimensions: quality.dimensions.map((dimension) => ({ id: dimension.id, score: dimension.score })),
  });
  history.snapshots = history.snapshots.slice(-100);
  QualityHistorySchema.parse(history);
  await writeJson(historyPath(root), history);
  return history;
}

export function summarizeQualityHistory(history: QualityHistory): QualityTrend | undefined {
  const latest = history.snapshots.at(-1);
  if (!latest) return undefined;
  const previous = history.snapshots.at(-2);
  const previousDimensions = new Map(previous?.dimensions.map((dimension) => [dimension.id, dimension.score]) ?? []);
  const dimensionDeltas = Object.fromEntries(latest.dimensions.map((dimension) => [
    dimension.id,
    dimension.score - (previousDimensions.get(dimension.id) ?? dimension.score),
  ])) as QualityTrend["dimensionDeltas"];
  const scores = history.snapshots.map((snapshot) => snapshot.score);
  return {
    snapshots: history.snapshots.length,
    score: latest.score,
    previousScore: previous?.score,
    delta: latest.score - (previous?.score ?? latest.score),
    bestScore: Math.max(...scores),
    lowestScore: Math.min(...scores),
    dimensionDeltas,
    series: scores.slice(-12),
  };
}
