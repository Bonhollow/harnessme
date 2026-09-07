import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
