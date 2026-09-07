import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname } from "node:path";
import { Parser, Language, type Node } from "web-tree-sitter";

const grammarByExtension: Record<string, string> = {
  ".bash": "bash",
  ".c": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "c-sharp",
  ".css": "css",
  ".cxx": "cpp",
  ".go": "go",
  ".h": "cpp",
  ".hpp": "cpp",
  ".ini": "ini",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".php": "php",
  ".ps1": "powershell",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sh": "bash",
};
const require = createRequire(import.meta.url);

let initialized: Promise<void> | undefined;
const languages = new Map<string, Promise<Language>>();

async function initialize(): Promise<void> {
  initialized ??= Parser.init({
    locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
  });
  return initialized;
}

async function loadLanguage(name: string): Promise<Language> {
  await initialize();
  let language = languages.get(name);
  if (!language) {
    language = Language.load(require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${name}.wasm`));
    languages.set(name, language);
  }
  return language;
}

export interface AstSignals {
  parsed: boolean;
  hasErrors: boolean;
  throws: Array<{ line: number; excerpt: string }>;
  catches: Array<{ line: number; excerpt: string }>;
  classes: number;
  inheritedClasses: Array<{ line: number; excerpt: string }>;
  imports: string[];
  testCalls: Array<{ line: number; excerpt: string }>;
  dependencyInjection: Array<{ line: number; excerpt: string }>;
  repositoryPatterns: Array<{ line: number; excerpt: string }>;
  resultPatterns: Array<{ line: number; excerpt: string }>;
}

function excerpt(node: Node): string {
  return node.text.replace(/\s+/gu, " ").trim().slice(0, 180);
}

function sourceSignals(source: string, pattern: RegExp): Array<{ line: number; excerpt: string }> {
  const signals: Array<{ line: number; excerpt: string }> = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (pattern.test(line)) signals.push({ line: index + 1, excerpt: line.trim().slice(0, 180) });
    pattern.lastIndex = 0;
    if (signals.length === 3) break;
  }
  return signals;
}

function importSpecifiers(source: string, grammar: string): string[] {
  const imports = new Set<string>();
  const pattern = grammar === "python"
    ? /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gmu
    : grammar === "cpp"
      ? /^\s*#include\s*["<]([^">]+)[">]/gmu
      : grammar === "rust"
        ? /^\s*use\s+([^;{]+)/gmu
        : grammar === "ruby"
          ? /^\s*require(?:_relative)?\s*['"]([^'"]+)['"]/gmu
          : grammar === "php"
            ? /^\s*use\s+([^;]+)/gmu
            : grammar === "bash"
              ? /^\s*(?:source|\.)\s+['"]?([^'"\s]+)['"]?/gmu
        : grammar === "c-sharp" || grammar === "java"
          ? /^\s*(?:using|import)\s+([\w.]+)/gmu
          : /\b(?:from\s*|import\s*\(?)['"]([^'"]+)['"]/gu;
  for (const match of source.matchAll(pattern)) {
    const value = match[1] ?? match[2];
    if (value) imports.add(value);
  }
  return [...imports];
}

export async function analyzeAst(path: string): Promise<AstSignals | undefined> {
  const grammar = grammarByExtension[extname(path).toLowerCase()];
  if (!grammar) return undefined;
  const source = await readFile(path, "utf8");
  const language = await loadLanguage(grammar);
  const parser = new Parser();
  try {
    parser.setLanguage(language);
    const tree = parser.parse(source);
    if (!tree) return undefined;
    const root = tree.rootNode;
    const throwTypes = grammar === "python" ? ["raise_statement"] : ["throw_statement", "throw_expression"];
    const catchTypes = grammar === "python" ? ["except_clause"] : ["catch_clause", "rescue"];
    const classTypes = ["class_declaration", "class_definition", "class_specifier", "struct_item"];
    const inherited: Array<{ line: number; excerpt: string }> = [];
    for (const node of root.descendantsOfType(classTypes)) {
      if (/\bextends\b|class\s+\w+\s*\([^)]/u.test(node.text)) {
        inherited.push({ line: node.startPosition.row + 1, excerpt: excerpt(node) });
      }
    }
    const calls = root.descendantsOfType("call_expression");
    return {
      parsed: true,
      hasErrors: root.hasError,
      throws: root.descendantsOfType(throwTypes).map((node) => ({
        line: node.startPosition.row + 1,
        excerpt: excerpt(node),
      })),
      catches: root.descendantsOfType(catchTypes).map((node) => ({
        line: node.startPosition.row + 1,
        excerpt: excerpt(node),
      })),
      classes: root.descendantsOfType(classTypes).length,
      inheritedClasses: inherited,
      imports: importSpecifiers(source, grammar),
      testCalls: calls
        .filter((node) => /^(describe|it|test|expect|pytest\.)/u.test(node.text.trim()))
        .slice(0, 3)
        .map((node) => ({ line: node.startPosition.row + 1, excerpt: excerpt(node) })),
      dependencyInjection: sourceSignals(source, /@Injectable|\b(?:inject|provide)\s*\(|constructor\s*\([^)]*(?:Service|Repository|Client)/u),
      repositoryPatterns: sourceSignals(source, /\b(?:class|interface|function)\s+\w*(?:Repository|Factory)\b/u),
      resultPatterns: sourceSignals(source, /\b(?:Result|Either|Outcome)\s*</u),
    };
  } finally {
    parser.delete();
  }
}
