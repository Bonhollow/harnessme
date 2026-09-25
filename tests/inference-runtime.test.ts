import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInferenceRuntime, discoverAvailableModels, resolveInferenceProvider } from "../packages/analyzers/src/inference.js";

const originalPath = process.env.PATH;
const temporaryDirectories: string[] = [];
afterEach(async () => {
  process.env.PATH = originalPath;
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fakeExecutable(body: string, name: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "harnessme-inference-test-"));
  temporaryDirectories.push(directory);
  const executable = join(directory, name);
  await writeFile(executable, `#!${process.execPath}\n${body}\n`);
  await chmod(executable, 0o755);
  process.env.PATH = directory;
}

async function fakeCursor(body: string, name = "cursor-agent"): Promise<void> {
  await fakeExecutable(body, name);
}

const cursorConfig = { provider: "cursor" as const, frameworks: ["cursor" as const], apiKeyEnv: "" };

describe.skipIf(process.platform === "win32")("Cursor inference runtime", () => {
  it("does not select an installed but signed-out Cursor CLI", async () => {
    await fakeCursor(`if (process.argv.includes("--version")) process.exit(0);
if (process.argv.includes("status")) { console.error("Not logged in"); process.exit(1); }
process.exit(1);`);
    expect(await resolveInferenceProvider(cursorConfig)).toBeUndefined();
  });

  it("reports a Cursor error envelope even when the CLI exits successfully", async () => {
    await fakeCursor(`if (process.argv.includes("--version") || process.argv.includes("status")) process.exit(0);
console.log(JSON.stringify({ type: "result", is_error: true, result: "Rate limit exceeded" }));`);
    const runtime = await createInferenceRuntime(cursorConfig);
    await expect(runtime.generate("probe", { type: "object" }, "Return JSON", "probe"))
      .rejects.toThrow(/Cursor inference failed: Rate limit exceeded/u);
  });

  it("does not mistake an unrelated agent executable for Cursor", async () => {
    await fakeCursor(`if (process.argv.includes("--help")) { console.log("Another agent"); process.exit(0); }
process.exit(0);`, "agent");
    expect(await resolveInferenceProvider(cursorConfig)).toBeUndefined();
  });

  it("parses a real-style Cursor result after notices and model prose", async () => {
    await fakeCursor(`if (process.argv.includes("--version") || process.argv.includes("status")) process.exit(0);
if (process.argv.includes("--list-models")) { console.log("Available models\\n\\nauto - Auto (default)\\ncomposer - Composer"); process.exit(0); }
console.log("Warning: stale settings");
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Here is the answer: {\\\"ok\\\":true}" }));`);
    expect(await discoverAvailableModels("cursor")).toEqual([{ id: "auto", label: "Auto (default)" }, { id: "composer", label: "Composer" }]);
    const runtime = await createInferenceRuntime(cursorConfig);
    expect(await runtime.generate("probe", { type: "object" }, "Return JSON", "probe")).toEqual({ ok: true });
  });

  it("reports a nonzero Cursor exit using stdout when stderr is empty", async () => {
    await fakeCursor(`if (process.argv.includes("--version") || process.argv.includes("status")) process.exit(0);
console.log("Authentication expired"); process.exit(2);`);
    const runtime = await createInferenceRuntime(cursorConfig);
    await expect(runtime.generate("probe", { type: "object" }, "Return JSON", "probe"))
      .rejects.toThrow(/Cursor inference failed: Authentication expired/u);
  });

  it("identifies invalid Cursor output with an actionable provider error", async () => {
    await fakeCursor(`if (process.argv.includes("--version") || process.argv.includes("status")) process.exit(0);
console.log(JSON.stringify({ type: "result", is_error: false, result: "I cannot provide JSON" }));`);
    const runtime = await createInferenceRuntime(cursorConfig);
    await expect(runtime.generate("probe", { type: "object" }, "Return JSON", "probe"))
      .rejects.toThrow(/Cursor inference returned invalid JSON/u);
  });
});

describe.skipIf(process.platform === "win32")("other CLI inference runtimes", () => {
  it("reads Codex structured output after checking login", async () => {
    await fakeExecutable(`const fs = require("node:fs");
if (process.argv.includes("--version") || process.argv.includes("login")) process.exit(0);
const output = process.argv[process.argv.indexOf("--output-last-message") + 1];
fs.writeFileSync(output, JSON.stringify({ ok: true }));`, "codex");
    const config = { provider: "codex" as const, frameworks: ["codex" as const], apiKeyEnv: "" };
    expect(await resolveInferenceProvider(config)).toBe("codex");
    expect(await (await createInferenceRuntime(config)).generate("probe", { type: "object" }, "Return JSON", "probe")).toEqual({ ok: true });
  });

  it("reports an early Codex CLI exit without an unhandled stdin pipe error", async () => {
    await fakeExecutable(`if (process.argv.includes("--version") || process.argv.includes("login")) process.exit(0);
console.log("Unknown model"); process.exit(2);`, "codex");
    const config = { provider: "codex" as const, frameworks: ["codex" as const], apiKeyEnv: "" };
    await expect((await createInferenceRuntime(config)).generate("probe", { type: "object" }, "Return JSON", "probe".repeat(100_000)))
      .rejects.toThrow(/Codex inference failed: Unknown model/u);
  });

  it("surfaces Claude's structured error envelope", async () => {
    await fakeExecutable(`if (process.argv.includes("--version") || process.argv.includes("auth")) process.exit(0);
console.log(JSON.stringify({ is_error: true, result: "Account limit reached" }));`, "claude");
    const config = { provider: "claude-code" as const, frameworks: ["claude-code" as const], apiKeyEnv: "" };
    await expect((await createInferenceRuntime(config)).generate("probe", { type: "object" }, "Return JSON", "probe"))
      .rejects.toThrow(/Claude Code inference failed: Account limit reached/u);
  });
});

describe("HTTP inference runtime", () => {
  it("sends the requested schema and parses structured content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "{\"ok\":true}" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const runtime = await createInferenceRuntime({ provider: "http", frameworks: [], endpoint: "https://example.test/v1/chat/completions", model: "test-model", apiKeyEnv: "" });
    expect(await runtime.generate("probe", { type: "object" }, "System", "Input")).toEqual({ ok: true });
    const request = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { response_format: { json_schema: { name: string } } };
    expect(request.response_format.json_schema.name).toBe("probe");
  });

  it("handles a real local chat-completions response and HTTP failure", async () => {
    let status = 200;
    const server = createServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(status === 200 ? JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }) : "{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a local TCP address");
      const runtime = await createInferenceRuntime({ provider: "http", frameworks: [], endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`, model: "local", apiKeyEnv: "" });
      expect(await runtime.generate("probe", { type: "object" }, "System", "Input")).toEqual({ ok: true });
      status = 429;
      await expect(runtime.generate("probe", { type: "object" }, "System", "Input"))
        .rejects.toThrow(/AI fallback request failed \(429/u);
    } finally {
      server.close();
    }
  });
});

describe.skipIf(process.platform !== "win32")("Windows inference shims", () => {
  it("launches Cursor through an npm .cmd shim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harnessme-cursor-windows-"));
    temporaryDirectories.push(directory);
    const script = join(directory, "cursor.js");
    await writeFile(script, `if (process.argv.includes("--version") || process.argv.includes("status")) process.exit(0);
console.log(JSON.stringify({ type: "result", is_error: false, result: "{\\\"ok\\\":true}" }));`);
    await writeFile(join(directory, "cursor-agent.cmd"), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    process.env.PATH = `${directory}${delimiter}${originalPath ?? ""}`;
    const runtime = await createInferenceRuntime(cursorConfig);
    expect(await runtime.generate("probe", { type: "object" }, "Return JSON", "probe")).toEqual({ ok: true });
  });
});
