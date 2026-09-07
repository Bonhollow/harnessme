import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "harnessme-package-"));
const { stdout } = await exec("npm", ["pack", "--silent", "--json", "--pack-destination", temporary], { cwd: root });
const jsonStart = Math.max(0, stdout.lastIndexOf("\n[") + 1);
const packed = JSON.parse(stdout.slice(jsonStart))[0];
if (!packed?.filename) throw new Error("npm pack did not produce a package filename.");
const tarball = join(temporary, packed.filename);
await exec("npm", ["install", "--ignore-scripts", tarball], { cwd: temporary });
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const executable = process.platform === "win32"
  ? join(temporary, "node_modules", ".bin", "harnessme.cmd")
  : join(temporary, "node_modules", ".bin", "harnessme");
const version = await exec(executable, ["--version"], { cwd: temporary });
if (!version.stdout.includes(manifest.version)) throw new Error(`Packed CLI reported an unexpected version: ${version.stdout.trim()}`);
