import { join } from "node:path";
import TOML from "@iarna/toml";
import yaml from "js-yaml";
import type { Convention, Evidence } from "@harnessme/core";
import { addConvention, addEvidence, lineOf, readable } from "./evidence.js";

export async function analyzeConfigs(root: string, evidence: Evidence[], facts: Convention[]): Promise<void> {
  const editorConfig = await readable(join(root, ".editorconfig"));
  if (editorConfig) {
    const indent = editorConfig.match(/^indent_style\s*=\s*(\w+)/mu)?.[1];
    const size = editorConfig.match(/^indent_size\s*=\s*(\d+)/mu)?.[1];
    const statement = indent ? `Use ${indent}${size ? ` indentation with width ${size}` : " indentation"}.` : "";
    if (statement) addConvention(facts, "formatting", statement, 1, [addEvidence(evidence, ".editorconfig", lineOf(editorConfig, "indent_style"), "config", statement)]);
  }
  for (const name of [".prettierrc", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml"]) {
    const content = await readable(join(root, name));
    if (!content) continue;
    try {
      const config = name.endsWith("yaml") || name.endsWith("yml") ? yaml.load(content) as Record<string, unknown> : JSON.parse(content) as Record<string, unknown>;
      for (const [key, label] of [["semi", "semicolons"], ["singleQuote", "single quotes"]] as const) {
        if (typeof config[key] === "boolean") {
          const statement = `${config[key] ? "Use" : "Do not use"} ${label}.`;
          addConvention(facts, "formatting", statement, 1, [addEvidence(evidence, name, lineOf(content, key), "config", `${key}: ${config[key]}`)]);
        }
      }
    } catch { /* The owning formatter reports malformed config. */ }
  }
  const tsconfig = await readable(join(root, "tsconfig.json"));
  if (tsconfig) {
    const strict = tsconfig.match(/"strict"\s*:\s*(true|false)/u)?.[1];
    if (strict) {
      const statement = strict === "true" ? "TypeScript strict type checking is required." : "TypeScript strict type checking is currently disabled; do not assume strict-null guarantees.";
      addConvention(facts, "tooling", statement, 1, [addEvidence(evidence, "tsconfig.json", lineOf(tsconfig, "\"strict\""), "config", `strict: ${strict}`)]);
    }
  }
  for (const name of ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", ".eslintrc", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"]) {
    if (!await readable(join(root, name))) continue;
    addConvention(facts, "tooling", "Run the repository's ESLint configuration for JavaScript and TypeScript changes.", 1, [addEvidence(evidence, name, 1, "config", "ESLint configuration present")]);
    break;
  }
  for (const name of ["pyproject.toml", "ruff.toml", ".ruff.toml"]) {
    const content = await readable(join(root, name));
    if (!content) continue;
    try {
      const config = TOML.parse(content) as Record<string, unknown>;
      const ruff = (name === "pyproject.toml" ? (config.tool as Record<string, unknown> | undefined)?.ruff : config) as Record<string, unknown> | undefined;
      const lineLength = ruff?.["line-length"];
      if (typeof lineLength === "number") addConvention(facts, "formatting", `Use a maximum Python line length of ${lineLength}.`, 1, [addEvidence(evidence, name, lineOf(content, "line-length"), "config", `line-length = ${lineLength}`)]);
      if (ruff) addConvention(facts, "tooling", "Run Ruff for Python linting and formatting.", 1, [addEvidence(evidence, name, lineOf(content, "ruff"), "config", "Ruff configuration present")]);
    } catch { /* The owning Python tool reports malformed config. */ }
  }
}
