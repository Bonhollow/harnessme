import { createHash } from "node:crypto";
import { join } from "node:path";
import { defineCommand } from "citty";
import {
  atomicWrite,
  exists,
  readCriticalRecords,
  readFacts,
  readText,
  validatePendingLine,
  writeFacts,
  writeVerifiedChanges,
} from "@harnessme/core";
import { analyzeProject } from "@harnessme/analyzers";
import {
  PENDING_END,
  PENDING_START,
  extractPending,
  syncHarness,
} from "@harnessme/renderers";
import { createProgress, info } from "../output.js";
import { projectRoot } from "../project.js";

function replacePending(content: string, lines: string[]): string {
  const start = content.indexOf(PENDING_START);
  const end = content.indexOf(PENDING_END);
  if (start < 0 || end < start) throw new Error("AGENTS.md has no valid HarnessME pending section.");
  const body = `\n### Pending updates (edit directly — no command needed)\nShipped or materially changed a feature? Add one dated bullet below.\n\n${lines.length ? `${lines.join("\n")}\n` : ""}`;
  return `${content.slice(0, start + PENDING_START.length)}${body}${content.slice(end)}`;
}

export default defineCommand({
  meta: { name: "validate", description: "Verify pending agent notes and reconcile facts" },
  args: {
    "max-retries": { type: "string", description: "Widened path searches", default: "2" },
    ci: { type: "boolean", description: "Fail if an entry still needs review" },
    root: { type: "string", description: "Repository root", valueHint: "path" },
  },
  async run({ args }) {
    const root = projectRoot(args.root);
    const progress = createProgress(5);
    progress.step("Reading pending harness updates");
    const maxRetries = Number.parseInt(String(args.maxRetries), 10);
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new Error("--max-retries must be a non-negative integer.");
    const agentsPath = join(root, "AGENTS.md");
    const agents = await readText(agentsPath);
    const pending = extractPending(agents);
    const lines = pending.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    progress.step("Verifying pending claims against repository evidence");
    const results = await Promise.all(lines.map((line) => validatePendingLine(root, line, maxRetries)));
    const unresolved = results
      .filter((result) => result.status !== "verified")
      .map((result) => result.status === "needs-review"
        ? `${result.original.replace(/\s+\[NEEDS-REVIEW:.*\]$/u, "")} [NEEDS-REVIEW: ${result.reason}]`
        : result.original);
    const verified = results.filter((result) => result.status === "verified");
    if (lines.length) await atomicWrite(agentsPath, replacePending(agents, unresolved));

    if (verified.length) {
      progress.step("Refreshing evidence-backed repository facts");
      const facts = await readFacts(root);
      const analysis = await analyzeProject({ root, ...facts.config.analysis });
      const retainedEvidence = new Set(facts.changes.changes.flatMap((change) => change.evidence));
      for (const item of facts.evidence.filter((candidate) => retainedEvidence.has(candidate.id))) {
        if (!analysis.evidence.some((candidate) => candidate.id === item.id)) analysis.evidence.push(item);
      }
      for (const result of verified) {
        const evidenceIds: string[] = [];
        for (const path of result.resolvedPaths) {
          const existing = analysis.evidence.find((item) => item.path === path);
          if (existing) evidenceIds.push(existing.id);
          else {
            const evidenceId = `ev-${createHash("sha256").update(`${path}:${result.summary}`, "utf8").digest("hex").slice(0, 12)}`;
            analysis.evidence.push({
              id: evidenceId,
              path,
              line: 1,
              kind: "git",
              excerpt: await exists(join(root, path)) ? `Verified material change: ${result.summary}` : "Verified file deletion",
            });
            evidenceIds.push(evidenceId);
          }
        }
        const changeId = `change-${createHash("sha256").update(result.original, "utf8").digest("hex").slice(0, 12)}`;
        if (!facts.changes.changes.some((change) => change.id === changeId)) {
          facts.changes.changes.push({
            id: changeId,
            date: result.date!,
            summary: result.summary!,
            paths: result.resolvedPaths,
            evidence: evidenceIds,
          });
        }
      }
      await writeFacts(root, analysis);
      await writeVerifiedChanges(root, facts.changes);
      info(`Verified ${verified.length} pending update(s) and refreshed evidence-backed facts.`);
    } else {
      progress.step("No verified fact refresh required");
    }
    progress.step("Checking critical-path review records");
    const records = await readCriticalRecords(root);
    const drafts = records.filter((record) => record.status === "draft");
    if (records.length) info(`Validated ${records.length} critical change record(s).`);
    progress.step("Regenerating agent integrations");
    await syncHarness(root);
    progress.done("Validation complete");
    if (unresolved.length) {
      info(`${unresolved.length} pending update(s) still need review.`);
      if (args.ci) process.exitCode = 1;
    }
    if (args.ci && drafts.length) {
      for (const draft of drafts) info(`::error title=HarnessME critical::Draft critical record requires approval: ${draft.file}`);
      process.exitCode = 1;
    }
    if (!lines.length && !records.length) info("No pending updates or critical records to validate.");
  },
});
