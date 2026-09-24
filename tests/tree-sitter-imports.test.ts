import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeAst } from "../packages/analyzers/src/tree-sitter.js";

describe("Python import analysis", () => {
  it("ignores imports shown inside a module docstring", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-python-imports-"));
    const path = join(root, "config.py");
    try {
      await writeFile(path, '"""Usage:\n    from package.config import Settings\n"""\nfrom package.runtime import Runtime\n');
      const signals = await analyzeAst(path);
      expect(signals?.imports.map((item) => item.specifier)).toEqual(["package.runtime"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
