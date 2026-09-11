import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createImportResolver } from "../packages/analyzers/src/import-resolver.js";

describe("repository-aware import resolution", () => {
  it("resolves Python src layouts and TypeScript path aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-imports-"));
    await mkdir(join(root, "src/coreval/api"), { recursive: true });
    await mkdir(join(root, "coreval-ui/src/lib"), { recursive: true });
    await writeFile(join(root, "pyproject.toml"), '[tool.setuptools]\npackage-dir = {"" = "src"}\n');
    await writeFile(join(root, "coreval-ui/tsconfig.json"), '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./src/*"]}}}');
    const files = new Set(["src/coreval/api/auth.py", "src/coreval/api/routes.py", "coreval-ui/src/lib/auth.ts", "coreval-ui/src/App.tsx"]);
    const resolve = await createImportResolver(root, files);
    expect(resolve("src/coreval/api/routes.py", "coreval.api.auth")).toBe("src/coreval/api/auth.py");
    expect(resolve("coreval-ui/src/App.tsx", "@/lib/auth")).toBe("coreval-ui/src/lib/auth.ts");
  });
});
