import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { headChangeId, stagedChangeId } from "../packages/core/src/governance.js";

const exec = promisify(execFile);

it("binds critical change IDs to exact bytes, including invalid UTF-8", async () => {
  const root = await mkdtemp(join(tmpdir(), "harnessme-binary-change-"));
  const path = "guarded.bin";
  await exec("git", ["init"], { cwd: root });
  await writeFile(join(root, path), Buffer.from([0x80]));
  await exec("git", ["add", path], { cwd: root });
  const firstStaged = await stagedChangeId(root, path);
  await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "first"], { cwd: root });
  const firstHead = await headChangeId(root, path);

  await writeFile(join(root, path), Buffer.from([0x81]));
  await exec("git", ["add", path], { cwd: root });
  const secondStaged = await stagedChangeId(root, path);
  expect(secondStaged).not.toBe(firstStaged);
  await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "second"], { cwd: root });
  expect(await headChangeId(root, path)).not.toBe(firstHead);
});
