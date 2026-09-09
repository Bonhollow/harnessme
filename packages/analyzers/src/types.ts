import type { AiFallbackConfig, AiReviewConfig, Conventions, DocumentationConflict, Evidence, Stack } from "@harnessme/core";

export interface AnalysisResult {
  conventions: Conventions;
  stack: Stack;
  evidence: Evidence[];
  architecture: string;
  hotspots: Array<{ path: string; changes: number; fanIn: number; score: number }>;
  warnings: string[];
  aiInputs?: Array<{ path: string; bytes: number; redactedLines: number }>;
  /** Redacted, bounded repository excerpts for authorship. This is never persisted. */
  authorContext?: string;
  sourceFiles: string[];
  commands: string[];
  documentationConflicts?: DocumentationConflict[];
}

export interface AnalyzeOptions {
  root: string;
  exclude: string[];
  maxFileBytes: number;
  aiFallback?: AiFallbackConfig;
  review?: AiReviewConfig;
}
