import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import type { z } from "zod";

export function projectPath(root: string, path: string): string {
  const target = resolve(root, path);
  const rel = relative(resolve(root), target);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`Refusing to access a path outside the project: ${path}`);
  }
  return target;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeYaml(path: string, value: unknown): Promise<void> {
  await atomicWrite(
    path,
    yaml.dump(value, { noRefs: true, lineWidth: 100, sortKeys: false }),
  );
}

export async function readYaml<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = yaml.load(await readText(path));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid ${path}:\n${parsed.error.message}`);
  }
  return parsed.data;
}

export async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const parsedJson = JSON.parse(await readText(path)) as unknown;
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`Invalid ${path}:\n${parsed.error.message}`);
  }
  return parsed.data;
}

export function posixPath(path: string): string {
  return path.replaceAll("\\", "/");
}
