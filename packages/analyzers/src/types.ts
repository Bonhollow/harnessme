import type { AiFallbackConfig, Conventions, Evidence, Stack } from "@harnessme/core";

export interface AnalysisResult {
  conventions: Conventions;
  stack: Stack;
  evidence: Evidence[];
  architecture: string;
  hotspots: Array<{ path: string; changes: number; fanIn: number; score: number }>;
  warnings: string[];
}

export interface AnalyzeOptions {
  root: string;
  exclude: string[];
  maxFileBytes: number;
  aiFallback?: AiFallbackConfig;
}
