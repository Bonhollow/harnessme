import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { stageRepositoryMutation } from "../packages/core/src/staged-repository.js";

const run = promisify(execFile);

describe("staged repository mutations", () => {
  it("preserves a concurrent edit instead of committing stale generated content", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-stage-concurrent-"));
    const path = join(root, "AGENTS.md");
    try {
      await writeFile(path, "original\n");
      await expect(stageRepositoryMutation(root, async (stagedRoot) => {
        await writeFile(join(stagedRoot, "AGENTS.md"), "generated\n");
        await writeFile(path, "concurrent edit\n");
      })).rejects.toThrow("Concurrent change detected at AGENTS.md");
      expect(await readFile(path, "utf8")).toBe("concurrent edit\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stages a linked Git worktree without writing through its shared Git directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harnessme-stage-worktree-"));
    const repository = join(directory, "repository");
    const worktree = join(directory, "worktree");
    try {
      await run("git", ["init", "-q", repository]);
      await writeFile(join(repository, "AGENTS.md"), "original\n");
      await run("git", ["-C", repository, "add", "AGENTS.md"]);
      await run("git", ["-C", repository, "-c", "user.name=HarnessME Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
      await run("git", ["-C", repository, "worktree", "add", "--detach", "-q", worktree]);
      await stageRepositoryMutation(worktree, async (stagedRoot) => {
        await writeFile(join(stagedRoot, "AGENTS.md"), "generated\n");
      });
      expect(await readFile(join(worktree, "AGENTS.md"), "utf8")).toBe("generated\n");
      expect(await readFile(join(repository, "AGENTS.md"), "utf8")).toBe("original\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
