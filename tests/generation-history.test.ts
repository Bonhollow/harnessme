import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureGeneration, listGenerations, previewGenerationRollback, rollbackGeneration } from "../packages/renderers/src/generation-history.js";
import { GENERATED_MARKER, PENDING_END, PENDING_START } from "../packages/renderers/src/agents-md.js";

function agents(version: string, pending = ""): string {
  return `${GENERATED_MARKER}\n${version}\n${PENDING_START}\n### Pending updates (edit directly — no command needed)\nShipped or materially changed a feature? Add one dated bullet below.\n\n${pending}${PENDING_END}\n`;
}

describe("harness generation history", () => {
  it("previews and restores an earlier set of managed documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-generation-"));
    await writeFile(join(root, "AGENTS.md"), agents("version one"));
    const first = await captureGeneration(root, "sync", ["AGENTS.md"]);

    await writeFile(join(root, "AGENTS.md"), agents("version two\nextra", "- 2026-09-11: keep current pending note\n"));
    await mkdir(join(root, ".harnessme", "features"), { recursive: true });
    await writeFile(join(root, ".harnessme", "features", "new.md"), `${GENERATED_MARKER}\nnew feature\n`);
    const second = await captureGeneration(root, "sync", ["AGENTS.md"]);
    expect(second.id).not.toBe(first.id);
    expect(await listGenerations(root)).toHaveLength(2);

    const preview = await previewGenerationRollback(root, first.id);
    expect(preview.changes).toContainEqual(expect.objectContaining({ path: "AGENTS.md", status: "modified" }));
    expect(preview.changes).toContainEqual(expect.objectContaining({ path: ".harnessme/features/new.md", status: "deleted" }));
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("version two");

    const restored = await rollbackGeneration(root, first.id);
    expect(restored.generation.id).toBe(first.id);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("version one");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("keep current pending note");
    await expect(access(join(root, ".harnessme", "features", "new.md"))).rejects.toThrow();
    expect((await listGenerations(root))[0]).toEqual(expect.objectContaining({ reason: "rollback" }));
  });

  it("does not duplicate identical consecutive snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-generation-dedup-"));
    await writeFile(join(root, "AGENTS.md"), agents("stable"));
    const first = await captureGeneration(root, "sync", ["AGENTS.md"]);
    const duplicate = await captureGeneration(root, "before-sync", ["AGENTS.md"]);
    expect(duplicate.id).toBe(first.id);
    expect(await listGenerations(root)).toHaveLength(1);
  });

  it("never rolls back merged maintainer-owned configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-generation-merged-"));
    await mkdir(join(root, ".github"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), agents("version one"));
    await writeFile(join(root, ".github", "CODEOWNERS"), "src/** @original-owner\n");
    const first = await captureGeneration(root, "sync", ["AGENTS.md", ".github/CODEOWNERS"]);
    await writeFile(join(root, "AGENTS.md"), agents("version two"));
    await writeFile(join(root, ".github", "CODEOWNERS"), "src/** @new-owner\n");
    await captureGeneration(root, "sync", ["AGENTS.md", ".github/CODEOWNERS"]);

    await rollbackGeneration(root, first.id);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("version one");
    expect(await readFile(join(root, ".github", "CODEOWNERS"), "utf8")).toBe("src/** @new-owner\n");
  });
});
