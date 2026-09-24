import { dirname, join } from "node:path";
import type { FactsSnapshot } from "./facts-store.js";
import { exists, posixPath, readText } from "./files.js";
import { findCriticalMatches, type CriticalMatch } from "./governance.js";
import { resolveChangeContext, type ChangeContext } from "./change-context.js";
import type { CriticalPaths } from "./schema.js";

export type PreflightAction = "edit" | "git" | "pull-request";

export interface PreflightDocument {
  path: string;
  content: string;
}

export interface RepositoryPreflight {
  status: "ready" | "approval-required";
  action: PreflightAction;
  paths: string[];
  documents: PreflightDocument[];
  criticalMatches: CriticalMatch[];
  changeContext: ChangeContext;
  next: string;
}

function safePaths(values: string[]): string[] {
  const paths = values.map((value) => posixPath(value.trim()).replace(/^\.\//u, ""));
  for (const path of paths) {
    if (!path || path.startsWith("/") || /^[A-Za-z]:\//u.test(path) || path.split("/").includes("..")) {
      throw new Error(`Preflight paths must stay inside the repository: ${path}`);
    }
  }
  return [...new Set(paths)];
}

async function nearestModuleInstructions(root: string, path: string): Promise<string | undefined> {
  let directory = dirname(path);
  while (directory !== ".") {
    const candidate = posixPath(join(directory, "AGENTS.md"));
    if (await exists(join(root, candidate))) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/** Assemble the complete pre-action contract for clients that do not discover repository instructions. */
export async function resolveRepositoryPreflight(
  root: string,
  facts: FactsSnapshot,
  criticalPaths: CriticalPaths,
  requestedPaths: string[],
  action: PreflightAction,
): Promise<RepositoryPreflight> {
  const paths = safePaths(requestedPaths);
  if (!paths.length) throw new Error("At least one repository path is required for preflight.");
  const documentPaths = new Set(["AGENTS.md", ".harnessme/CRITICAL.md"]);
  if (await exists(join(root, ".harnessme/agent-pack/agent.md"))) {
    documentPaths.add(".harnessme/agent-pack/agent.md");
  }
  for (const path of paths) {
    const scoped = await nearestModuleInstructions(root, path);
    if (scoped) documentPaths.add(scoped);
  }
  const documents = await Promise.all([...documentPaths].map(async (path) => ({ path, content: await readText(join(root, path)) })));
  const criticalMatches = findCriticalMatches(criticalPaths, paths);
  const status = criticalMatches.length ? "approval-required" : "ready";
  return {
    status,
    action,
    paths,
    documents,
    criticalMatches,
    changeContext: resolveChangeContext(facts, paths),
    next: status === "approval-required"
      ? "Stop and request explicit human approval before proceeding. After approval, use harnessme_draft_critical_record; a listed human must approve the exact staged content."
      : "Follow the returned instructions and validation plan before proceeding.",
  };
}
