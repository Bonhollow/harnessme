import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const cli = resolve("dist/cli.js");

async function execWithInput(command: string, args: string[], input: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ stdout, stderr, code }));
    child.stdin.end(input);
  });
}

describe("CLI", () => {
  it.skipIf(process.platform === "win32")("reuses the selected Codex runtime for harness inference", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-codex-runtime-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const fakeCodex = join(bin, "codex");
    await writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) { console.log("codex-test"); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  const output = process.argv[process.argv.indexOf("--output-last-message") + 1];
  const schema = process.argv[process.argv.indexOf("--output-schema") + 1];
  const value = schema.includes("harnessme_facts")
    ? { facts: [{ id: "lang-kotlin", kind: "language", language: "Kotlin", category: "tooling", statement: "Kotlin source is present.", path: "App.kt", line: 1, excerpt: "class Application" }] }
    : { approvedIds: ["lang-kotlin"] };
  fs.writeFileSync(output, JSON.stringify(value));
});
`);
    await chmod(fakeCodex, 0o755);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "codex-runtime-fixture" }));
    await writeFile(join(root, "App.kt"), "class Application\n");
    await exec(process.execPath, [cli, "init", "--root", root, "--provider", "codex"], {
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
    });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("Kotlin (100%)");
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    const configuration = await readFile(join(root, ".harnessme", "harnessme.yaml"), "utf8");
    expect(configuration).toContain("- cursor");
    expect(configuration).toContain("provider: codex");
  }, 30_000);

  it("uses a verified AI fallback for source without a bundled grammar", async () => {
    let requests = 0;
    const requestBodies: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.once("end", () => {
        requestBodies.push(body);
        requests += 1;
        const content = requests === 1
          ? JSON.stringify({ facts: [
            { id: "language-swift", kind: "language", language: "Swift", category: "tooling", statement: "Swift source is present.", path: "Payment.swift", line: 1, excerpt: "struct PaymentService {" },
            { id: "pascal-types", kind: "convention", language: "Swift", category: "naming", statement: "Use PascalCase names for declared types.", path: "Payment.swift", line: 1, excerpt: "struct PaymentService {" },
            { id: "payment-boundary", kind: "architecture", language: "Swift", category: "tooling", statement: "PaymentService is a payment-domain boundary.", path: "Payment.swift", line: 1, excerpt: "struct PaymentService {" },
          ] })
          : JSON.stringify({ approvedIds: ["language-swift", "pascal-types", "payment-boundary"] });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test AI server did not expose a port.");
      const root = await mkdtemp(join(tmpdir(), "harnessme-ai-"));
      await writeFile(join(root, "package.json"), JSON.stringify({ name: "ai-fixture" }));
      await writeFile(join(root, "Payment.swift"), "struct PaymentService {\n  let apiKey = \"sk-this-must-never-leave-the-machine\"\n}\n");
      await exec(process.execPath, [
        cli, "init", "--root", root, "--provider", "http",
        "--ai-endpoint", `http://127.0.0.1:${address.port}/v1/chat/completions`, "--model", "test-model",
      ]);
      const agents = await readFile(join(root, "AGENTS.md"), "utf8");
      expect(agents).toContain("Swift (100%)");
      expect(agents).toContain("Use PascalCase names for declared types. Evidence: `Payment.swift:1`");
      expect(agents).toContain("PaymentService is a payment-domain boundary. Evidence: `Payment.swift:1`");
      expect(requests).toBe(2);
      expect(requestBodies.join("\n")).not.toContain("sk-this-must-never-leave-the-machine");
      expect(requestBodies[0]).toContain("REDACTED SECRET-LIKE LINE");
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }
  }, 30_000);

  it("promotes high fan-in source files to critical paths during init", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-fanin-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fanin-fixture" }));
    await writeFile(join(root, "core.ts"), "export const core = true;\n");
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(root, `consumer-${index}.ts`), "import { core } from './core';\nexport const value = core;\n");
    }
    await exec(process.execPath, [cli, "init", "--root", root, "--deterministic", "--critical-approvers", "owner"]);
    const registry = await readFile(join(root, ".harnessme", "critical-paths.yaml"), "utf8");
    expect(registry).toContain("glob: core.ts");
    expect(registry).toContain("source: heuristic");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("`core.ts`");
  }, 30_000);

  it("initializes, renders, and detects drift in a mixed-language repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-test-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "fixture",
      dependencies: { react: "19.0.0" },
      devDependencies: { vitest: "3.2.7" },
    }, null, 2));
    await writeFile(join(root, ".editorconfig"), "root = true\n[*]\nindent_style = space\nindent_size = 2\n");
    await writeFile(join(root, "service.ts"), "export function run(): void { throw new Error('no'); }\n");
    await writeFile(join(root, "worker.py"), "def run():\n    raise RuntimeError('no')\n");
    await writeFile(join(root, "PaymentService.cs"), "public class PaymentService { public void Run() { throw new System.Exception(); } }\n");

    const initialized = await exec(process.execPath, [cli, "init", "--root", root, "--deterministic", "--targets", "codex,claude-code"]);
    expect(initialized.stdout).toContain("Initialized HarnessME");
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("Evidence: `.editorconfig:3`");
    expect(agents).toContain("uses exceptions for error propagation");
    expect(agents).toContain("C#");
    expect(initialized.stderr).not.toContain("Could not parse");
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    const claudeSettings = await readFile(join(root, ".claude", "settings.json"), "utf8");
    expect(claudeSettings).toContain("critical-gate");
    expect(claudeSettings).toContain("--hook");

    const clean = await exec(process.execPath, [cli, "check", "--ci", "--root", root]);
    expect(clean.stdout).toContain("check passed");

    const withPending = agents.replace(
      "<!-- HARNESSME:PENDING:END -->",
      "- 2026-09-07: changed `service.ts`\n<!-- HARNESSME:PENDING:END -->",
    );
    await writeFile(join(root, "AGENTS.md"), withPending);
    const validated = await exec(process.execPath, [cli, "validate", "--root", root]);
    expect(validated.stdout).toContain("Verified 1 pending update");
    const validatedAgents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(validatedAgents).toContain("## Verified material changes");
    expect(validatedAgents).toContain("2026-09-07: changed `service.ts`");
    expect(validatedAgents.split("<!-- HARNESSME:PENDING:START -->")[1]).not.toContain("changed `service.ts`");

    const falseClaim = validatedAgents.replace(
      "<!-- HARNESSME:PENDING:END -->",
      "- 2026-09-07: added OAuth authentication to `service.ts`\n<!-- HARNESSME:PENDING:END -->",
    );
    await writeFile(join(root, "AGENTS.md"), falseClaim);
    await expect(exec(process.execPath, [cli, "validate", "--ci", "--root", root])).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("NEEDS-REVIEW: claim terms were not found");

    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
    pkg.dependencies = { react: "19.0.0", express: "5.0.0" };
    await writeFile(join(root, "package.json"), JSON.stringify(pkg, null, 2));
    await expect(exec(process.execPath, [cli, "check", "--ci", "--root", root])).rejects.toMatchObject({ code: 1 });
  }, 30_000);

  it("binds critical approval to the exact staged file content", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-gate-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "gate-fixture" }, null, 2));
    await writeFile(join(root, "payment.ts"), "export const amount = 1;\n");
    await exec("git", ["init"], { cwd: root });
    await exec("git", ["add", "package.json", "payment.ts"], { cwd: root });
    await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial"], { cwd: root });
    await exec(process.execPath, [cli, "init", "--root", root, "--deterministic"]);
    await exec(process.execPath, [cli, "hooks", "install", "--root", root]);
    expect((await exec(process.execPath, [cli, "hooks", "status", "--root", root])).stdout).toContain("is installed");
    await exec(process.execPath, [cli, "critical", "add", "payment.ts", "--reason", "money movement", "--approvers", "owner", "--root", root]);
    const hook = await execWithInput(process.execPath, [cli, "critical-gate", "--hook", "--root", root], JSON.stringify({ tool_input: { file_path: join(root, "payment.ts") } }));
    expect(hook.code).toBe(0);
    expect(hook.stdout).toContain('"permissionDecision":"ask"');
    const drafted = await exec(process.execPath, [cli, "critical", "draft", "payment.ts", "--summary", "change amount", "--root", root]);
    const record = drafted.stdout.match(/critical-log\/([^\s]+\.md)/u)?.[1];
    expect(record).toBeTruthy();

    await writeFile(join(root, "payment.ts"), "export const amount = 2;\n");
    await exec("git", ["add", "payment.ts"], { cwd: root });
    await exec(process.execPath, [cli, "critical", "approve", record!, "--approver", "owner", "--root", root]);
    await exec("git", ["add", `.harnessme/critical-log/${record}`, ".harnessme/CRITICAL.md"], { cwd: root });
    const passed = await exec(process.execPath, [cli, "critical-gate", "--root", root]);
    expect(passed.stdout).toContain("Critical gate passed");

    await writeFile(join(root, "payment.ts"), "export const amount = 3;\n");
    await exec("git", ["add", "payment.ts"], { cwd: root });
    await expect(exec(process.execPath, [cli, "critical-gate", "--root", root])).rejects.toMatchObject({ code: 2 });

    await writeFile(join(root, "payment.ts"), "export const amount = 2;\n");
    await exec("git", ["add", "."], { cwd: root });
    await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-verify", "-m", "approved critical change"], { cwd: root });
    const deletionDraft = await exec(process.execPath, [cli, "critical", "draft", "payment.ts", "--summary", "remove legacy payment", "--root", root]);
    const deletionRecord = deletionDraft.stdout.match(/critical-log\/([^\s]+\.md)/u)?.[1];
    await exec("git", ["rm", "payment.ts"], { cwd: root });
    await exec(process.execPath, [cli, "critical", "approve", deletionRecord!, "--approver", "owner", "--root", root]);
    await exec("git", ["add", `.harnessme/critical-log/${deletionRecord}`, ".harnessme/CRITICAL.md"], { cwd: root });
    const deletionPassed = await exec(process.execPath, [cli, "critical-gate", "--root", root]);
    expect(deletionPassed.stdout).toContain("Critical gate passed");
  }, 30_000);
});
