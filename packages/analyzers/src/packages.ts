import { stat } from "node:fs/promises";
import { join } from "node:path";
import TOML from "@iarna/toml";
import type { Evidence, Stack } from "@harnessme/core";
import { addEvidence, lineOf, readable } from "./evidence.js";

function frameworkName(name: string): string | undefined {
  const known: Record<string, string> = {
    react: "React", next: "Next.js", vue: "Vue", svelte: "Svelte", express: "Express", fastify: "Fastify",
    nestjs: "NestJS", "@nestjs/core": "NestJS", django: "Django", flask: "Flask", fastapi: "FastAPI", pytest: "pytest",
  };
  return known[name.toLowerCase()];
}

export async function packageFacts(root: string, evidence: Evidence[]): Promise<{ packageManagers: string[]; frameworks: string[]; dependencies: Stack["dependencies"] }> {
  const packageManagers: string[] = [];
  const frameworks = new Set<string>();
  const dependencies: Stack["dependencies"] = [];
  for (const [file, manager] of Object.entries({ "package-lock.json": "npm", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "bun.lock": "bun", "bun.lockb": "bun", "uv.lock": "uv", "poetry.lock": "Poetry" })) {
    try { await stat(join(root, file)); if (!packageManagers.includes(manager)) packageManagers.push(manager); } catch { /* absent */ }
  }
  const packageJson = await readable(join(root, "package.json"));
  if (packageJson) {
    const pkg = JSON.parse(packageJson) as { packageManager?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    if (pkg.packageManager) packageManagers.push(pkg.packageManager);
    for (const [kind, values] of [["runtime", pkg.dependencies], ["development", pkg.devDependencies]] as const) {
      for (const [name, version] of Object.entries(values ?? {})) {
        dependencies.push({ name, version, kind, source: "package.json" });
        addEvidence(evidence, "package.json", lineOf(packageJson, `"${name}"`), "dependency", `${name}: ${version}`);
        const framework = frameworkName(name); if (framework) frameworks.add(framework);
      }
    }
  }
  const pyproject = await readable(join(root, "pyproject.toml"));
  if (pyproject) {
    try {
      const project = (TOML.parse(pyproject) as Record<string, unknown>).project as { dependencies?: string[] } | undefined;
      for (const spec of project?.dependencies ?? []) {
        const name = spec.match(/^[A-Za-z0-9_.-]+/u)?.[0] ?? spec;
        dependencies.push({ name, version: spec.slice(name.length) || "*", kind: "python", source: "pyproject.toml" });
        addEvidence(evidence, "pyproject.toml", lineOf(pyproject, spec), "dependency", spec);
        const framework = frameworkName(name); if (framework) frameworks.add(framework);
      }
    } catch { /* Keep scanning while metadata is invalid. */ }
  }
  return { packageManagers: [...new Set(packageManagers)].sort(), frameworks: [...frameworks].sort(), dependencies: dependencies.sort((a, b) => a.name.localeCompare(b.name)) };
}
