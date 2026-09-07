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

function isValidationScript(name: string): boolean {
  if (/(?:^|:)(?:dev|fix|serve|start|watch)$/u.test(name)) return false;
  return /^(?:build|check|lint|test|type-check|typecheck|validate|verify)(?::|$)/u.test(name)
    || /^(?:format|prettier):(?:check|verify)$/u.test(name);
}

export async function packageFacts(root: string, evidence: Evidence[]): Promise<{ packageManagers: string[]; frameworks: string[]; dependencies: Stack["dependencies"]; commands: string[] }> {
  const packageManagers: string[] = [];
  const frameworks = new Set<string>();
  const dependencies: Stack["dependencies"] = [];
  const commands: string[] = [];
  for (const [file, manager] of Object.entries({ "package-lock.json": "npm", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "bun.lock": "bun", "bun.lockb": "bun", "uv.lock": "uv", "poetry.lock": "Poetry" })) {
    try { await stat(join(root, file)); if (!packageManagers.includes(manager)) packageManagers.push(manager); } catch { /* absent */ }
  }
  const packageJson = await readable(join(root, "package.json"));
  if (packageJson) {
    const pkg = JSON.parse(packageJson) as { packageManager?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    if (pkg.packageManager) packageManagers.push(pkg.packageManager);
    const runner = pkg.packageManager?.split("@")[0] || (packageManagers.includes("pnpm") ? "pnpm" : packageManagers.includes("yarn") ? "yarn" : "npm");
    for (const name of Object.keys(pkg.scripts ?? {}).filter(isValidationScript).sort()) {
      commands.push(runner === "npm" ? `npm run ${name}` : `${runner} ${name}`);
      addEvidence(evidence, "package.json", lineOf(packageJson, `"${name}"`), "config", `script: ${name}`);
    }
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
  return { packageManagers: [...new Set(packageManagers)].sort(), frameworks: [...frameworks].sort(), dependencies: dependencies.sort((a, b) => a.name.localeCompare(b.name)), commands };
}
