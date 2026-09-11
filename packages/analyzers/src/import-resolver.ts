import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import fg from "fast-glob";
import { posixPath } from "../../core/src/files.js";

interface Alias { prefix: string; target: string; configDir: string }

function candidates(base: string): string[] {
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".rs", ".sh", ".bash", ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"];
  const bases = [base];
  if (/\.(?:js|jsx|mjs|cjs)$/u.test(base)) bases.push(base.replace(/\.(?:js|jsx|mjs|cjs)$/u, ""));
  return bases.flatMap((candidate) => [
    ...extensions.map((suffix) => `${candidate}${suffix}`),
    ...extensions.slice(1).flatMap((suffix) => [`${candidate}/index${suffix}`, `${candidate}/mod${suffix}`, `${candidate}/__init__${suffix}`]),
  ]);
}

function firstExisting(bases: string[], files: Set<string>): string | undefined {
  return bases.flatMap(candidates).find((candidate) => files.has(candidate));
}

async function configuration(root: string): Promise<{ pythonRoots: string[]; aliases: Alias[] }> {
  const pythonRoots = new Set<string>([""]);
  const aliases: Alias[] = [];
  const configs = await fg(["**/pyproject.toml", "**/tsconfig*.json", "**/vite.config.{ts,js,mts,mjs}"], {
    cwd: root, onlyFiles: true, ignore: ["**/node_modules/**", "**/.git/**", "**/.harnessme/**"],
  });
  for (const config of configs) {
    const source = await readFile(join(root, config), "utf8");
    const configDir = posixPath(dirname(config)) === "." ? "" : posixPath(dirname(config));
    if (config.endsWith("pyproject.toml")) {
      for (const match of source.matchAll(/(?:package-dir\s*=\s*\{\s*""\s*=|where\s*=\s*\[)\s*["']([^"']+)["']/gu)) {
        if (match[1]) pythonRoots.add(posixPath(join(configDir, match[1])));
      }
    }
    if (/tsconfig[^/]*\.json$/u.test(config)) {
      const baseUrl = source.match(/"baseUrl"\s*:\s*"([^"]+)"/u)?.[1] ?? ".";
      const pathsBlock = source.match(/"paths"\s*:\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
      for (const match of pathsBlock.matchAll(/"([^"]+)"\s*:\s*\[\s*"([^"]+)"/gu)) {
        const prefix = (match[1] ?? "").replace(/\*.*$/u, "");
        const target = (match[2] ?? "").replace(/\*.*$/u, "");
        if (prefix && target) aliases.push({ prefix, target: posixPath(join(baseUrl, target)), configDir });
      }
    }
    if (/vite\.config\./u.test(config)) {
      for (const match of source.matchAll(/["']([^"']+)["']\s*:\s*path\.resolve\(\s*__dirname\s*,\s*["']([^"']+)["']\s*\)/gu)) {
        if (match[1] && match[2]) aliases.push({ prefix: match[1], target: match[2], configDir });
      }
    }
  }
  return { pythonRoots: [...pythonRoots], aliases: aliases.sort((a, b) => b.prefix.length - a.prefix.length) };
}

/** Build one repository-aware resolver and reuse it for hotspot and graph analysis. */
export async function createImportResolver(root: string, files: Set<string>): Promise<(from: string, specifier: string) => string | undefined> {
  const { pythonRoots, aliases } = await configuration(root);
  return (from, specifier) => {
    const extension = extname(from).toLowerCase();
    if (specifier.startsWith(".")) {
      if (extension === ".py") {
        const dots = specifier.match(/^\.+/u)?.[0].length ?? 1;
        const remainder = specifier.slice(dots).replaceAll(".", "/");
        let parent = dirname(from);
        for (let index = 1; index < dots; index += 1) parent = dirname(parent);
        return firstExisting([posixPath(join(parent, remainder))], files);
      }
      return firstExisting([posixPath(normalize(join(dirname(from), specifier)))], files);
    }
    if (extension === ".py") {
      const modulePath = specifier.replaceAll(".", "/");
      return firstExisting(pythonRoots.map((sourceRoot) => posixPath(join(sourceRoot, modulePath))), files);
    }
    const alias = aliases.find((item) => specifier === item.prefix || specifier.startsWith(item.prefix));
    if (alias) {
      const suffix = specifier.slice(alias.prefix.length);
      const base = posixPath(normalize(join(alias.configDir, alias.target, suffix)));
      const resolved = firstExisting([base], files);
      if (resolved) return resolved;
    }
    if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".rb", ".sh", ".bash"].includes(extension)) {
      return firstExisting([posixPath(normalize(join(dirname(from), specifier)))], files);
    }
    if (extension === ".rs") {
      const parts = specifier.replace(/^(?:crate|self|super)::/u, "").replaceAll("::", "/");
      const start = specifier.startsWith("crate::") ? "src" : specifier.startsWith("super::") ? join(dirname(from), "..") : dirname(from);
      return firstExisting([posixPath(normalize(join(start, parts)))], files);
    }
    if ([".java", ".cs", ".php"].includes(extension)) {
      const suffix = `${specifier.replaceAll("\\", "/").replaceAll(".", "/")}${extension}`;
      return [...files].find((file) => file.endsWith(suffix));
    }
    if (extension === ".go") {
      const directory = specifier.split("/").at(-1);
      return directory ? [...files].find((file) => file.endsWith(".go") && (dirname(file) === directory || dirname(file).endsWith(`/${directory}`))) : undefined;
    }
    return undefined;
  };
}
