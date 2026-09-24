import { spawn } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitBytesResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export function runGitBytes(root: string, args: string[]): Promise<GitBytesResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: Buffer) => { stdout.push(chunk); });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr }));
  });
}

export async function runGit(root: string, args: string[]): Promise<GitResult> {
  const result = await runGitBytes(root, args);
  return { code: result.code, stdout: result.stdout.toString("utf8"), stderr: result.stderr };
}

export async function gitText(root: string, args: string[], description: string): Promise<string> {
  const result = await runGit(root, args);
  if (result.code !== 0) {
    throw new Error(`${description}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

export async function tryGitText(root: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await runGit(root, args);
    return result.code === 0 ? result.stdout : undefined;
  } catch {
    return undefined;
  }
}
