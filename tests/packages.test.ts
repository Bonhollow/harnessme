import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Evidence } from "@harnessme/core";
import { packageFacts } from "../packages/analyzers/src/packages.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("package facts", () => {
  it("records validation scripts without recommending lifecycle or watch commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-package-facts-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), JSON.stringify({
      scripts: {
        build: "tsc",
        lint: "eslint .",
        "test:unit": "vitest run",
        "test:watch": "vitest",
        start: "node server.js",
        release: "npm publish",
      },
    }));
    const evidence: Evidence[] = [];
    const facts = await packageFacts(root, evidence);
    expect(facts.commands).toEqual(["npm run build", "npm run lint", "npm run test:unit"]);
    expect(evidence.map((item) => item.excerpt)).not.toContain("script: release");
  });

  it("discovers Pixi tasks and nested package validation commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-monorepo-facts-"));
    roots.push(root);
    await mkdir(join(root, "ui"));
    await writeFile(join(root, "README.md"), "# Fixture\n\nEvaluation service for repository changes.\n");
    await writeFile(join(root, "pixi.lock"), "version: 6\n");
    await writeFile(join(root, "pixi.toml"), "[tasks]\nbuild = \"python -m build\"\ntest = \"python -m pytest tests\"\npublish = \"python publish.py\"\n");
    await writeFile(join(root, "ui", "package.json"), JSON.stringify({
      name: "ui",
      scripts: { build: "vite build", lint: "eslint .", dev: "vite" },
      dependencies: { react: "^19.0.0" },
    }));
    await writeFile(join(root, "ui", "package-lock.json"), "{}\n");

    const facts = await packageFacts(root, []);

    expect(facts.commands).toEqual([
      "npm --prefix ui run build",
      "npm --prefix ui run lint",
      "pixi run build",
      "pixi run test",
    ]);
    expect(facts.frameworks).toContain("React");
    expect(facts.packageManagers).toEqual(expect.arrayContaining(["npm", "Pixi"]));
    expect(facts.projectSummary).toBe("Evaluation service for repository changes.");
  });
});
