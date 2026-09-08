import { dirname, join } from "node:path";
import TOML from "@iarna/toml";
import fg from "fast-glob";
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

function markdownSummary(content: string): string | undefined {
  return content.split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("[") && !line.startsWith("!") && !line.startsWith("<") && !line.startsWith("|"));
}

export async function packageFacts(root: string, evidence: Evidence[]): Promise<{ packageManagers: string[]; frameworks: string[]; dependencies: Stack["dependencies"]; commands: string[]; projectSummary?: string }> {
  const packageManagers: string[] = [];
  const frameworks = new Set<string>();
  const dependencies: Stack["dependencies"] = [];
  const commands: string[] = [];
  const readme = await readable(join(root, "README.md"));
  const projectSummary = readme ? markdownSummary(readme) : undefined;
  if (readme && projectSummary) addEvidence(evidence, "README.md", lineOf(readme, projectSummary), "structure", projectSummary);
  for (const [file, manager] of Object.entries({ "package-lock.json": "npm", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "bun.lock": "bun", "bun.lockb": "bun", "uv.lock": "uv", "poetry.lock": "Poetry", "pixi.lock": "Pixi" })) {
    const matches = await fg([file, `**/${file}`], { cwd: root, onlyFiles: true, ignore: ["**/node_modules/**", "**/.git/**", "**/.harnessme/**", "**/dist/**", "**/build/**"] });
    if (matches.length && !packageManagers.includes(manager)) packageManagers.push(manager);
  }
  const packageFiles = await fg(["package.json", "**/package.json"], { cwd: root, onlyFiles: true, unique: true, ignore: ["**/node_modules/**", "**/.git/**", "**/.harnessme/**", "**/dist/**", "**/build/**"] });
  for (const packageFile of packageFiles.sort()) {
    const packageJson = await readable(join(root, packageFile));
    if (!packageJson) continue;
    const pkg = JSON.parse(packageJson) as { packageManager?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    if (pkg.packageManager) packageManagers.push(pkg.packageManager);
    const normalizedDirectory = dirname(packageFile).replaceAll("\\", "/");
    const packageDirectory = normalizedDirectory === "." ? "" : normalizedDirectory;
    const runner = pkg.packageManager?.split("@")[0]
      || (await readable(join(root, packageDirectory, "pnpm-lock.yaml")) ? "pnpm"
        : await readable(join(root, packageDirectory, "yarn.lock")) ? "yarn"
          : await readable(join(root, packageDirectory, "bun.lock")) || await readable(join(root, packageDirectory, "bun.lockb")) ? "bun" : "npm");
    for (const name of Object.keys(pkg.scripts ?? {}).filter(isValidationScript).sort()) {
      const command = packageDirectory
        ? runner === "npm" ? `npm --prefix ${packageDirectory} run ${name}`
          : runner === "yarn" ? `yarn --cwd ${packageDirectory} ${name}`
            : runner === "pnpm" ? `pnpm --dir ${packageDirectory} ${name}`
              : `bun --cwd ${packageDirectory} run ${name}`
        : runner === "npm" ? `npm run ${name}` : `${runner} ${name}`;
      commands.push(command);
      addEvidence(evidence, packageFile, lineOf(packageJson, `"${name}"`), "config", `script: ${name}`);
    }
    for (const [kind, values] of [["runtime", pkg.dependencies], ["development", pkg.devDependencies]] as const) {
      for (const [name, version] of Object.entries(values ?? {})) {
        dependencies.push({ name, version, kind, source: packageFile });
        addEvidence(evidence, packageFile, lineOf(packageJson, `"${name}"`), "dependency", `${name}: ${version}`);
        const framework = frameworkName(name); if (framework) frameworks.add(framework);
      }
    }
  }
  const pixiToml = await readable(join(root, "pixi.toml"));
  if (pixiToml) {
    try {
      const tasks = (TOML.parse(pixiToml) as Record<string, unknown>).tasks as Record<string, unknown> | undefined;
      for (const name of Object.keys(tasks ?? {}).filter(isValidationScript).sort()) {
        commands.push(`pixi run ${name}`);
        addEvidence(evidence, "pixi.toml", lineOf(pixiToml, `${name} =`), "config", `task: ${name}`);
      }
      if (!packageManagers.includes("Pixi")) packageManagers.push("Pixi");
    } catch { /* The owning package manager reports malformed metadata. */ }
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
  return {
    packageManagers: [...new Set(packageManagers)].sort(),
    frameworks: [...frameworks].sort(),
    dependencies: dependencies.sort((a, b) => a.name.localeCompare(b.name)),
    commands: [...new Set(commands)].sort(),
    projectSummary,
  };
}
