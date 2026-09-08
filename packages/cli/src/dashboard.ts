import { spawn } from "node:child_process";

function nodeSupportsOpenTui(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 26 || (major === 26 && minor >= 4);
}

export async function dashboard(root = process.cwd()): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("Run `harnessme init`, `harnessme refresh`, or `harnessme --help`. The dashboard requires an interactive terminal.\n");
    return;
  }
  if (!nodeSupportsOpenTui()) throw new Error("The HarnessME dashboard requires Node.js 26.4 or newer.");
  if (!process.execArgv.includes("--experimental-ffi")) {
    const entry = process.argv[1];
    if (!entry) throw new Error("Cannot locate the HarnessME executable.");
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ["--experimental-ffi", "--disable-warning=ExperimentalWarning", entry, ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
      child.once("error", reject);
      child.once("close", (status) => resolve(status ?? 1));
    });
    if (code !== 0) process.exitCode = code;
    return;
  }
  const { openDashboard } = await import("./dashboard/index.js");
  await openDashboard(root);
}
