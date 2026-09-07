import { posixPath, tryGitText } from "@harnessme/core";

export async function gitHotspots(
  root: string,
  limit = 0,
): Promise<Array<{ path: string; changes: number }>> {
  const output = await tryGitText(root, ["log", "--format=", "--name-only", "--no-renames"]) ?? "";
  const counts = new Map<string, number>();
  for (const line of output.split(/\r?\n/u)) {
    const path = posixPath(line.trim());
    if (!path || path.startsWith(".harnessme/") || path.startsWith(".git/")) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const sorted = [...counts.entries()]
    .map(([path, changes]) => ({ path, changes }))
    .sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path));
  return limit > 0 ? sorted.slice(0, limit) : sorted;
}
