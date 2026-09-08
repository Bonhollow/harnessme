import { stat } from "node:fs/promises";
import { basename, dirname, extname, join, normalize } from "node:path";
import fg from "fast-glob";
import {
  posixPath,
  type Convention,
  type Evidence,
  type Stack,
} from "@harnessme/core";
import { gitHotspots } from "./git.js";
import { analyzeAst } from "./tree-sitter.js";
import type { AnalysisResult, AnalyzeOptions } from "./types.js";
import { analyzeConfigs } from "./configs.js";
import { addConvention, addEvidence, readable } from "./evidence.js";
import { packageFacts } from "./packages.js";
import { analyzeWithAiFallback } from "./ai-fallback.js";
import { InferenceUnavailableError } from "./inference.js";
import { analyzeDocumentation } from "./documentation.js";

const sourcePatterns = ["**/*.{bash,c,cc,cpp,cs,css,cxx,go,h,hpp,ini,java,js,jsx,mjs,cjs,php,ps1,py,rb,rs,sh,ts,tsx}"];
const languageByExtension: Record<string, string> = {
  ".bash": "Shell",
  ".c": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".cxx": "C++",
  ".go": "Go",
  ".h": "C/C++ Header",
  ".hpp": "C++ Header",
  ".ini": "INI",
  ".java": "Java",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".php": "PHP",
  ".ps1": "PowerShell",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".sh": "Shell",
};
const supportedExtensions = new Set(Object.keys(languageByExtension));

function topLevelModules(files: string[]): string[] {
  const modules = new Set<string>();
  for (const file of files) {
    const parts = posixPath(file).split("/");
    if (parts.length > 1 && parts[0] && !parts[0].startsWith(".")) modules.add(parts[0]);
  }
  return [...modules].sort();
}

function renderArchitecture(
  projectName: string,
  modules: string[],
  languages: Stack["languages"],
  hotspots: AnalysisResult["hotspots"],
  inferredArchitecture: Array<{ statement: string; path: string; line: number }>,
): string {
  const moduleLines = modules.length ? modules.map((name) => `- \`${name}/\``).join("\n") : "- No top-level source directories detected.";
  const languageText = languages.length ? languages.map((item) => `${item.name} (${item.files} files)`).join(", ") : "No supported source files detected";
  const fanInLines = hotspots.filter((item) => item.fanIn > 0).slice(0, 10)
    .map((item) => `- \`${item.path}\`: ${item.fanIn} inbound import${item.fanIn === 1 ? "" : "s"}`).join("\n")
    || "- No local import hubs detected.";
  const inferredLines = inferredArchitecture.length
    ? inferredArchitecture.map((item) => `- ${item.statement} Evidence: \`${item.path}:${item.line}\`.`).join("\n")
    : "- No additional model-inferred architecture recorded.";
  return `# Observed architecture\n\nThis document is generated from the repository structure. Log material changes in the generated \`AGENTS.md\` pending section, then run \`harnessme validate\` to refresh these facts.\n\n## Project\n\n${projectName}\n\n## Languages\n\n${languageText}.\n\n## Top-level module boundaries\n\n${moduleLines}\n\n## Import hubs\n\n${fanInLines}\n\n## Verified model-assisted observations\n\n${inferredLines}\n`;
}

function resolveImport(from: string, specifier: string, files: Set<string>): string | undefined {
  let base: string;
  const extension = extname(from).toLowerCase();
  if (specifier.startsWith(".")) base = posixPath(normalize(join(dirname(from), specifier)));
  else if (extension === ".py") base = specifier.replaceAll(".", "/");
  else if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".rb", ".sh", ".bash"].includes(extension)) {
    base = posixPath(normalize(join(dirname(from), specifier)));
  } else if (extension === ".rs") {
    const parts = specifier.replace(/^(?:crate|self|super)::/u, "").replaceAll("::", "/");
    const start = specifier.startsWith("crate::") ? "src" : specifier.startsWith("super::") ? join(dirname(from), "..") : dirname(from);
    base = posixPath(normalize(join(start, parts)));
  } else if ([".java", ".cs", ".php"].includes(extension)) {
    const suffix = `${specifier.replaceAll("\\", "/").replaceAll(".", "/")}${extension}`;
    return [...files].find((file) => file.endsWith(suffix));
  } else if (extension === ".go") {
    const directory = specifier.split("/").at(-1);
    if (!directory) return undefined;
    return [...files].find((file) => {
      const parent = posixPath(dirname(file));
      return file.endsWith(".go") && (parent === directory || parent.endsWith(`/${directory}`));
    });
  } else return undefined;
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".rs", ".sh", ".bash", ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"];
  for (const suffix of extensions) {
    if (files.has(`${base}${suffix}`)) return `${base}${suffix}`;
  }
  for (const suffix of extensions.slice(1)) {
    if (files.has(`${base}/index${suffix}`)) return `${base}/index${suffix}`;
    if (files.has(`${base}/mod${suffix}`)) return `${base}/mod${suffix}`;
  }
  return undefined;
}

export async function analyzeProject(options: AnalyzeOptions): Promise<AnalysisResult> {
  const { root, exclude, maxFileBytes } = options;
  const files = await fg(sourcePatterns, {
    cwd: root,
    onlyFiles: true,
    unique: true,
    ignore: exclude,
    followSymbolicLinks: false,
  });
  files.sort();
  const evidence: Evidence[] = [];
  const facts: Convention[] = [];
  const warnings: string[] = [];
  const languageCounts = new Map<string, number>();
  let totalClasses = 0;
  let inheritedClasses = 0;
  let throwCount = 0;
  let catchCount = 0;
  let firstThrowEvidence: string | undefined;
  let firstInheritanceEvidence: string | undefined;
  let firstTestEvidence: string | undefined;
  let firstDependencyInjectionEvidence: string | undefined;
  let firstRepositoryEvidence: string | undefined;
  let firstResultEvidence: string | undefined;
  const importsByFile = new Map<string, string[]>();
  let inferredArchitecture: Array<{ statement: string; path: string; line: number }> = [];
  let aiInputs: AnalysisResult["aiInputs"];
  let inferredConflicts: NonNullable<AnalysisResult["documentationConflicts"]> = [];

  for (const relativePath of files) {
    const absolutePath = join(root, relativePath);
    const fileStat = await stat(absolutePath);
    if (fileStat.size > maxFileBytes) {
      warnings.push(`Skipped oversized source file: ${posixPath(relativePath)}`);
      continue;
    }
    const language = languageByExtension[extname(relativePath).toLowerCase()];
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    try {
      const signals = await analyzeAst(absolutePath);
      if (!signals) continue;
      importsByFile.set(posixPath(relativePath), signals.imports);
      if (signals.hasErrors) warnings.push(`Tree-sitter recovered from syntax errors in ${posixPath(relativePath)}`);
      totalClasses += signals.classes;
      inheritedClasses += signals.inheritedClasses.length;
      throwCount += signals.throws.length;
      catchCount += signals.catches.length;
      const thrown = signals.throws[0];
      if (!firstThrowEvidence && thrown) {
        firstThrowEvidence = addEvidence(evidence, posixPath(relativePath), thrown.line, "ast", thrown.excerpt);
      }
      const inherited = signals.inheritedClasses[0];
      if (!firstInheritanceEvidence && inherited) {
        firstInheritanceEvidence = addEvidence(evidence, posixPath(relativePath), inherited.line, "ast", inherited.excerpt);
      }
      const test = signals.testCalls[0];
      if (!firstTestEvidence && test) {
        firstTestEvidence = addEvidence(evidence, posixPath(relativePath), test.line, "ast", test.excerpt);
      }
      const dependencyInjection = signals.dependencyInjection[0];
      if (!firstDependencyInjectionEvidence && dependencyInjection) {
        firstDependencyInjectionEvidence = addEvidence(evidence, posixPath(relativePath), dependencyInjection.line, "ast", dependencyInjection.excerpt);
      }
      const repository = signals.repositoryPatterns[0];
      if (!firstRepositoryEvidence && repository) {
        firstRepositoryEvidence = addEvidence(evidence, posixPath(relativePath), repository.line, "ast", repository.excerpt);
      }
      const result = signals.resultPatterns[0];
      if (!firstResultEvidence && result) {
        firstResultEvidence = addEvidence(evidence, posixPath(relativePath), result.line, "ast", result.excerpt);
      }
    } catch (error) {
      warnings.push(`Could not parse ${posixPath(relativePath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (options.aiFallback?.enabled) {
    try {
      const fallback = await analyzeWithAiFallback(root, exclude, supportedExtensions, options.aiFallback, options.review);
      if (fallback.runtime) {
        warnings.push(fallback.independentlyReviewed && fallback.reviewRuntime
          ? `Model-assisted harness inference used ${fallback.runtime}; facts were independently reviewed by ${fallback.reviewRuntime}.`
          : `Model-assisted harness inference used ${fallback.runtime}.`);
      }
      evidence.push(...fallback.evidence.filter((item) => !evidence.some((existing) => existing.id === item.id)));
      facts.push(...fallback.conventions.filter((item) => !facts.some((existing) => existing.id === item.id)));
      const languagesByFile = new Map(fallback.languages.map((item) => [item.path, item.name]));
      for (const language of languagesByFile.values()) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
      files.push(...fallback.files.filter((path) => !files.includes(path)));
      inferredArchitecture = fallback.architecture;
      inferredConflicts = fallback.conflicts;
      aiInputs = fallback.inputs;
    } catch (error) {
      if (!(error instanceof InferenceUnavailableError) || options.aiFallback.provider !== "auto") throw error;
      warnings.push(`${error.message} Continuing with deterministic analysis.`);
    }
  }

  await analyzeConfigs(root, evidence, facts);
  if (firstThrowEvidence && throwCount > 0) {
    addConvention(facts, "error-handling", `The codebase uses exceptions for error propagation (${throwCount} throw/raise sites and ${catchCount} catch/except sites detected).`, 0.9, [firstThrowEvidence]);
  }
  if (firstInheritanceEvidence && totalClasses > 0) {
    addConvention(facts, "oop", `Inheritance is present in ${inheritedClasses} of ${totalClasses} detected class declarations; preserve established base-class contracts when editing them.`, 0.85, [firstInheritanceEvidence]);
  }
  if (firstTestEvidence) {
    addConvention(facts, "testing", "The repository contains test-style calls; update nearby tests when changing behavior.", 0.85, [firstTestEvidence]);
  }
  if (firstDependencyInjectionEvidence) {
    addConvention(facts, "oop", "Dependency injection is used; preserve existing injection boundaries instead of constructing collaborators ad hoc.", 0.85, [firstDependencyInjectionEvidence]);
  }
  if (firstRepositoryEvidence) {
    addConvention(facts, "oop", "Repository or factory abstractions are present; keep persistence and object-creation concerns behind those seams.", 0.85, [firstRepositoryEvidence]);
  }
  if (firstResultEvidence) {
    addConvention(facts, "error-handling", "Result-style return values are used; preserve explicit success/error handling at those boundaries.", 0.85, [firstResultEvidence]);
  }
  const contributing = await readable(join(root, "CONTRIBUTING.md"));
  if (contributing) {
    const ev = addEvidence(evidence, "CONTRIBUTING.md", 1, "config", "Repository contribution guide present");
    addConvention(facts, "tooling", "Follow the repository's CONTRIBUTING.md workflow for changes and verification.", 1, [ev]);
  }

  const counts = [...languageCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = counts.reduce((sum, [, count]) => sum + count, 0);
  const languages = counts.map(([name, count]) => ({
    name,
    files: count,
    percentage: total === 0 ? 0 : Math.round((count / total) * 10_000) / 100,
  }));
  for (const language of languages) {
    const sample = files.find((file) => languageByExtension[extname(file).toLowerCase()] === language.name);
    if (sample) addEvidence(evidence, posixPath(sample), 1, "structure", `${language.name} source file`);
  }

  const packageData = await packageFacts(root, evidence);
  const modules = topLevelModules(files);
  const documentation = await analyzeDocumentation(root, exclude);
  for (const module of modules) addEvidence(evidence, `${module}/`, 1, "structure", "Top-level module directory");
  const now = new Date().toISOString();
  const stack: Stack = {
    schemaVersion: 1,
    generatedAt: now,
    languages,
    packageManagers: packageData.packageManagers,
    frameworks: packageData.frameworks,
    dependencies: packageData.dependencies,
    topLevelModules: modules,
    validationCommands: packageData.commands,
    projectSummary: packageData.projectSummary,
    documentationPaths: documentation.paths,
  };
  const packageJson = await readable(join(root, "package.json"));
  const projectName = packageJson
    ? ((JSON.parse(packageJson) as { name?: string }).name ?? basename(root))
    : basename(root);
  const sourceFiles = new Set(files.map(posixPath));
  const fanIn = new Map<string, number>();
  for (const [from, imports] of importsByFile) {
    for (const specifier of imports) {
      const target = resolveImport(from, specifier, sourceFiles);
      if (target) fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
    }
  }
  const changes = new Map((await gitHotspots(root)).map((item) => [item.path, item.changes]));
  const hotspots = [...sourceFiles]
    .map((path) => {
      const changeCount = changes.get(path) ?? 0;
      const inbound = fanIn.get(path) ?? 0;
      return { path, changes: changeCount, fanIn: inbound, score: changeCount + inbound * 5 };
    })
    .filter((item) => item.changes > 0 || item.fanIn > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {
    conventions: { schemaVersion: 1, generatedAt: now, facts: facts.sort((a, b) => a.id.localeCompare(b.id)) },
    stack,
    evidence: evidence.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
    architecture: renderArchitecture(projectName, modules, languages, hotspots, inferredArchitecture),
    hotspots,
    warnings,
    aiInputs,
    sourceFiles: [...new Set(files.map(posixPath))].sort(),
    commands: packageData.commands,
    documentationConflicts: [...documentation.conflicts, ...inferredConflicts]
      .filter((item, index, items) => items.findIndex((candidate) =>
        candidate.document === item.document && candidate.line === item.line && candidate.reference === item.reference
      ) === index),
  };
}
