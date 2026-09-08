import { z } from "zod";

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  kind: z.enum(["config", "ast", "dependency", "structure", "git", "ai"]),
  excerpt: z.string().min(1),
});

export const ConventionSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "formatting",
    "naming",
    "imports",
    "error-handling",
    "oop",
    "testing",
    "tooling",
  ]),
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)).min(1),
});

export const ConventionsSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  facts: z.array(ConventionSchema),
});

export const DependencySchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  kind: z.enum(["runtime", "development", "python"]),
  source: z.string().min(1),
});

export const LanguageSchema = z.object({
  name: z.string().min(1),
  files: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
});

export const StackSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  languages: z.array(LanguageSchema),
  packageManagers: z.array(z.string()),
  frameworks: z.array(z.string()),
  dependencies: z.array(DependencySchema),
  topLevelModules: z.array(z.string()),
  validationCommands: z.array(z.string()).optional(),
  projectSummary: z.string().min(1).optional(),
  documentationPaths: z.array(z.string()).optional(),
});

const InferenceConfigSchema = z.object({
  provider: z.enum(["auto", "codex", "claude-code", "cursor", "http"]).default("auto"),
  frameworks: z.array(z.enum(["codex", "claude-code", "cursor"])).default([]),
  endpoint: z.string().url().optional(),
  model: z.string().min(1).optional(),
  apiKeyEnv: z.string().default(""),
});

const HarnessConfigObjectSchema = z.object({
  schemaVersion: z.literal(1),
  targets: z.array(z.string().min(1)).min(1),
  languages: z.array(z.string()),
  analysis: z.object({
    exclude: z.array(z.string()),
    maxFileBytes: z.number().int().positive().default(524_288),
    aiFallback: InferenceConfigSchema.extend({
      enabled: z.boolean(),
      maxFiles: z.number().int().positive().max(100).default(40),
      maxFileBytes: z.number().int().positive().max(262_144).default(65_536),
      include: z.array(z.string().min(1)).default(["**/*"]),
      exclude: z.array(z.string().min(1)).default([]),
    }).optional(),
    review: InferenceConfigSchema.optional(),
  }),
  distribution: z.object({
    backend: z.enum(["ruler", "native"]).default("ruler"),
  }),
});

export const HarnessConfigSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return record.targets ? record : { ...record, targets: record.providers };
}, HarnessConfigObjectSchema);

export const CriticalPathSchema = z.object({
  glob: z.string().min(1),
  reason: z.string().min(1),
  approvers: z.array(z.string().min(1)).min(1),
  source: z.enum(["explicit", "heuristic", "ai-reviewed"]).default("explicit"),
  status: z.enum(["proposed", "active"]).default("active"),
  risk: z.enum(["security", "persistence", "public-contract", "billing", "deployment", "shared-core", "other"]).optional(),
});

export const CriticalPathsSchema = z.object({
  schemaVersion: z.literal(1),
  paths: z.array(CriticalPathSchema),
  heuristics: z.object({
    enabled: z.boolean(),
    minChanges: z.number().int().nonnegative(),
    minFanIn: z.number().int().nonnegative().default(5),
    minScore: z.number().nonnegative().default(25),
  }),
});

export const VerifiedChangeSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  summary: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  evidence: z.array(z.string().min(1)).min(1),
});

export const VerifiedChangesSchema = z.object({
  schemaVersion: z.literal(1),
  changes: z.array(VerifiedChangeSchema),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type Convention = z.infer<typeof ConventionSchema>;
export type Conventions = z.infer<typeof ConventionsSchema>;
export type Stack = z.infer<typeof StackSchema>;
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
export type AiFallbackConfig = NonNullable<HarnessConfig["analysis"]["aiFallback"]>;
export type AiReviewConfig = NonNullable<HarnessConfig["analysis"]["review"]>;
export type CriticalPaths = z.infer<typeof CriticalPathsSchema>;
export type VerifiedChange = z.infer<typeof VerifiedChangeSchema>;
export type VerifiedChanges = z.infer<typeof VerifiedChangesSchema>;

export const ReferenceDocumentSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  title: z.string().min(1).max(120),
  scope: z.string().min(1).max(500),
  description: z.string().min(1).max(300),
  markdown: z.string().min(100).max(8_000),
});

export const ReferencePackSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  documents: z.array(ReferenceDocumentSchema).max(20),
});

export const DocumentationConflictSchema = z.object({
  kind: z.enum(["missing-path", "contradiction"]).default("missing-path"),
  document: z.string().min(1),
  line: z.number().int().positive(),
  reference: z.string().min(1),
  message: z.string().min(1),
  implementationPath: z.string().min(1).optional(),
  implementationLine: z.number().int().positive().optional(),
});

export const HarnessQualitySchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  score: z.number().int().min(0).max(100),
  checks: z.array(z.object({
    id: z.string().min(1),
    passed: z.boolean(),
    points: z.number().int().nonnegative(),
    message: z.string().min(1),
  })),
});

export type ReferenceDocument = z.infer<typeof ReferenceDocumentSchema>;
export type ReferencePack = z.infer<typeof ReferencePackSchema>;
export type DocumentationConflict = z.infer<typeof DocumentationConflictSchema>;
export type HarnessQuality = z.infer<typeof HarnessQualitySchema>;

export const DEFAULT_EXCLUDES = [
  "**/.git/**",
  "**/.harnessme/**",
  "**/.ruler/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/vendor/**",
];

export const defaultConfig = (targets: string[]): HarnessConfig => ({
  schemaVersion: 1,
  targets,
  languages: [],
  analysis: { exclude: [...DEFAULT_EXCLUDES], maxFileBytes: 524_288 },
  distribution: { backend: "ruler" },
});

export const defaultCriticalPaths = (): CriticalPaths => ({
  schemaVersion: 1,
  paths: [],
  heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 },
});

export const defaultVerifiedChanges = (): VerifiedChanges => ({ schemaVersion: 1, changes: [] });
