import { isAbsolute, join, relative } from "node:path";
import {
  atomicWrite,
  exists,
  findCriticalMatches,
  posixPath,
  readCriticalPaths,
  readText,
  renderSharedGovernance,
  type CriticalMatch,
  type CriticalPaths,
} from "@harnessme/core";

function hookPaths(value: unknown): string[] {
  const paths = new Set<string>();
  function visit(item: unknown): void {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if ((key === "file_path" || key === "path") && typeof child === "string") paths.add(child);
      else visit(child);
    }
  }
  visit(value);
  return [...paths];
}

export function parseClaudeHookPaths(input: unknown, root: string): string[] {
  return hookPaths(input).map((path) => posixPath(isAbsolute(path) ? relative(root, path) : path).replace(/^\.\//u, ""));
}

export function renderClaudeConfirmation(matches: CriticalMatch[]): string | undefined {
  if (!matches.length) return undefined;
  const reason = matches.map((match) => `${match.path}: ${match.reason}`).join("; ");
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `HarnessME requires explicit developer confirmation before editing: ${reason}`,
    },
  })}\n`;
}

export async function evaluateClaudeHook(root: string, input: unknown): Promise<string | undefined> {
  const paths = parseClaudeHookPaths(input, root);
  return renderClaudeConfirmation(findCriticalMatches(await readCriticalPaths(root), paths));
}

async function renderClaudeHook(root: string): Promise<string> {
  const relativePath = ".claude/settings.json";
  const path = join(root, relativePath);
  let settings: Record<string, unknown> = {};
  if (await exists(path)) {
    try {
      settings = JSON.parse(await readText(path)) as Record<string, unknown>;
    } catch {
      throw new Error(`Cannot merge HarnessME hook into invalid JSON: ${relativePath}`);
    }
  }
  const hooks = (settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}) as Record<string, unknown>;
  const preToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse as Array<Record<string, unknown>> : [];
  if (!preToolUse.some((group) => JSON.stringify(group).includes("critical-gate"))) {
    preToolUse.push({ matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: "harnessme critical-gate --hook" }] });
  }
  hooks.PreToolUse = preToolUse;
  settings.hooks = hooks;
  await atomicWrite(path, `${JSON.stringify(settings, null, 2)}\n`);
  return relativePath;
}

export async function renderGovernance(root: string, config: CriticalPaths, claudeEnabled: boolean): Promise<string[]> {
  const files = await renderSharedGovernance(root, config);
  if (claudeEnabled) files.push(await renderClaudeHook(root));
  return files;
}
