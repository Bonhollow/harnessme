import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const OMITTED_DIRECTORIES = new Set(["node_modules", ".venv", "venv", "__pycache__", ".tox"]);

interface FileState { hash: string; mode: number }
interface Change { path: string; before?: FileState; after?: FileState }
interface Backup { path: string; content?: Buffer; mode?: number }

async function fileState(path: string): Promise<FileState> {
  const stat = await lstat(path);
  const hash = createHash("sha256");
  if (stat.size <= 8 * 1024 * 1024) hash.update(await readFile(path));
  else for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { hash: hash.digest("hex"), mode: stat.mode & 0o7777 };
}

async function fileTree(root: string): Promise<Map<string, FileState>> {
  const files = new Map<string, FileState>();
  const paths: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = relative(root, path);
      if (name === ".git") continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) paths.push(name);
      else if (entry.isSymbolicLink()) throw new Error(`Staged repository contains an unsupported symbolic link: ${name}`);
    }
  }
  await visit(root);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(16, paths.length) }, async () => {
    while (next < paths.length) {
      const name = paths[next++]!;
      files.set(name, await fileState(join(root, name)));
    }
  }));
  return files;
}

function changesBetween(before: Map<string, FileState>, after: Map<string, FileState>): Change[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((path) => {
    const oldState = before.get(path);
    const newState = after.get(path);
    return oldState?.hash === newState?.hash && oldState?.mode === newState?.mode
      ? [] : [{ path, before: oldState, after: newState }];
  });
}

async function statIfPresent(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try { return await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function copyForStaging(root: string, stagedRoot: string): Promise<void> {
  const gitEntry = await statIfPresent(join(root, ".git"));
  let independentGit = false;
  if (gitEntry) {
    try {
      await run("git", ["clone", "--shared", "--quiet", "--no-checkout", "--", root, stagedRoot]);
      independentGit = true;
    } catch (error) {
      if (!gitEntry.isDirectory()) throw error;
    }
  }
  await cp(root, stagedRoot, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    filter: async (source) => {
      const path = relative(root, source);
      if (path && path.split(sep).some((part) => OMITTED_DIRECTORIES.has(part))) return false;
      if (independentGit && (path === ".git" || path.startsWith(`.git${sep}`))) return false;
      const stat = await lstat(source);
      return stat.isDirectory() || stat.isFile();
    },
  });
}

async function checkParentDirectories(root: string, path: string, created: Set<string>): Promise<void> {
  let parent = dirname(join(root, path));
  const base = resolve(root);
  while (parent !== base) {
    const stat = await statIfPresent(parent);
    if (stat && !stat.isDirectory()) throw new Error(`Cannot update ${path}: a parent is not a directory.`);
    if (!stat) created.add(parent);
    parent = dirname(parent);
  }
}

async function atomicWriteBytes(path: string, content: Buffer, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content);
    await chmod(temporary, mode);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function applyChanges(root: string, stagedRoot: string, changes: Change[]): Promise<void> {
  const backups: Backup[] = [];
  const prepared = new Map<string, Buffer>();
  const createdDirectories = new Set<string>();
  for (const change of changes) {
    const target = join(root, change.path);
    await checkParentDirectories(root, change.path, createdDirectories);
    const stat = await statIfPresent(target);
    if (stat && !stat.isFile()) throw new Error(`Cannot update ${change.path}: the path is not a regular file.`);
    if (Boolean(stat) !== Boolean(change.before)) throw new Error(`Concurrent change detected at ${change.path}.`);
    if (stat) {
      const current = await fileState(target);
      if (current.hash !== change.before?.hash || current.mode !== change.before?.mode) {
        throw new Error(`Concurrent change detected at ${change.path}.`);
      }
    }
    backups.push({ path: change.path, content: stat ? await readFile(target) : undefined, mode: stat ? Number(stat.mode) & 0o7777 : undefined });
    if (change.after) {
      const content = await readFile(join(stagedRoot, change.path));
      if (createHash("sha256").update(content).digest("hex") !== change.after.hash) {
        throw new Error(`Staged output changed while preparing ${change.path}.`);
      }
      prepared.set(change.path, content);
    }
  }
  const ordered = [...changes].sort((left, right) => Number(Boolean(left.after)) - Number(Boolean(right.after)) || left.path.localeCompare(right.path));
  const applied: string[] = [];
  try {
    for (const change of ordered) {
      const target = join(root, change.path);
      if (change.after) await atomicWriteBytes(target, prepared.get(change.path)!, change.after.mode);
      else await rm(target);
      applied.push(change.path);
    }
  } catch (error) {
    const byPath = new Map(backups.map((backup) => [backup.path, backup]));
    const failures: unknown[] = [];
    for (const path of applied.reverse()) {
      const backup = byPath.get(path)!;
      try {
        if (backup.content) await atomicWriteBytes(join(root, path), backup.content, backup.mode!);
        else await rm(join(root, path), { force: true });
      } catch (rollbackError) { failures.push(rollbackError); }
    }
    for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      try { await rmdir(directory); }
      catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT" && (cleanupError as NodeJS.ErrnoException).code !== "ENOTEMPTY") failures.push(cleanupError);
      }
    }
    if (failures.length) throw new AggregateError([error, ...failures], "Repository update failed and rollback was incomplete.");
    throw error;
  }
}

/** Prepare a repository mutation away from the caller's worktree, then commit its file diff with rollback. */
export async function stageRepositoryMutation<T>(root: string, mutate: (stagedRoot: string) => Promise<T>): Promise<T> {
  const temporary = await mkdtemp(join(tmpdir(), "harnessme-stage-"));
  const stagedRoot = join(temporary, basename(resolve(root)) || "repository");
  try {
    await copyForStaging(root, stagedRoot);
    const before = await fileTree(stagedRoot);
    const result = await mutate(stagedRoot);
    await applyChanges(root, stagedRoot, changesBetween(before, await fileTree(stagedRoot)));
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
