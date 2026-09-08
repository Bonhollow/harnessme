import type { FactsSnapshot } from "./facts-store.js";
import type { DocumentationConflict, HarnessQuality } from "./schema.js";

function has(markdown: string, heading: string): boolean {
  return markdown.includes(`## ${heading}`);
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const bodyStart = start + heading.length + 3;
  const next = markdown.slice(bodyStart).search(/^##\s+/mu);
  return markdown.slice(bodyStart, next < 0 ? undefined : bodyStart + next);
}

export function assessHarnessQuality(
  facts: FactsSnapshot,
  conflicts: DocumentationConflict[] = [],
  renderedMarkdown?: string,
): HarnessQuality {
  const markdown = renderedMarkdown ?? facts.authoredInstructions ?? "";
  const workflow = section(markdown, "Change workflows");
  const groundedPaths = [
    ...facts.evidence.map((item) => item.path),
    ...facts.stack.topLevelModules.map((module) => `${module}/`),
  ];
  const checks = [
    { id: "purpose", passed: Boolean(facts.stack.projectSummary), points: 10, message: "Repository purpose is grounded in project metadata or documentation." },
    { id: "documentation", passed: Boolean(facts.stack.documentationPaths?.length), points: 10, message: "Task-relevant repository documentation is discoverable." },
    { id: "validation", passed: Boolean(facts.stack.validationCommands?.length), points: 15, message: "Repository-specific validation commands are verified." },
    { id: "evidence", passed: facts.evidence.length > 0 && facts.conventions.facts.every((fact) => fact.evidence.length > 0), points: 10, message: "Operating claims have repository evidence." },
    { id: "operating-contract", passed: has(markdown, "Before editing") && has(markdown, "Operating rules"), points: 15, message: "The authored harness includes pre-edit and operating instructions." },
    { id: "core-boundaries", passed: /`[^`]+`/u.test(section(markdown, "Core boundaries")) && !/no explicit core boundary/iu.test(section(markdown, "Core boundaries")), points: 15, message: "Concrete core boundaries are identified by path." },
    { id: "workflows", passed: has(markdown, "Change workflows") && groundedPaths.some((path) => workflow.includes(`\`${path}\``)), points: 10, message: "Common changes have repository-specific workflows grounded in concrete paths." },
    { id: "reference-pack", passed: Boolean(facts.referencePack?.documents.length), points: 10, message: "Scoped reference documents provide progressive disclosure." },
    { id: "documentation-consistency", passed: conflicts.length === 0, points: 5, message: conflicts.length ? `${conflicts.length} documentation/code conflict(s) require review.` : "No broken repository-path references were found in operating documentation." },
    { id: "ai-authoring", passed: facts.generation?.status !== "deterministic-fallback", points: 0, message: facts.generation?.status === "deterministic-fallback" ? `AI authorship fell back to deterministic guidance: ${facts.generation.reason ?? "validation failed"}` : "AI authoring status does not indicate a rejected authored harness." },
  ];
  const rawScore = checks.filter((check) => check.passed).reduce((sum, check) => sum + check.points, 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    score: facts.generation?.status === "deterministic-fallback" ? Math.min(rawScore, 60) : rawScore,
    checks,
  };
}
