import spawn from "cross-spawn";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiReviewConfig } from "@harnessme/core";

export interface InferenceRuntime {
  name: string;
  generate(schemaName: string, schema: object, system: string, input: string): Promise<unknown>;
}

export class InferenceUnavailableError extends Error {}

export type InferenceProviderId = "codex" | "claude-code" | "cursor" | "http";

export interface AvailableModel {
  id: string;
  label: string;
}

export interface InferenceEvent {
  provider: string;
  stage: string;
  status: "started" | "waiting" | "completed" | "failed";
  elapsedMs: number;
}

export type InferenceObserver = (event: InferenceEvent) => void;

export interface ProviderDiagnosis {
  provider: InferenceProviderId;
  command?: string;
  installed: boolean;
  authenticated: boolean;
  models: AvailableModel[];
  modelDiscovery: "available" | "unsupported" | "failed";
  probe?: { ok: boolean; elapsedMs: number; error?: string };
}

interface ProcessResult { code: number | null; stdout: string; stderr: string }

async function run(command: string, args: string[], cwd: string, input = "", timeoutMs = 120_000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    // cross-spawn resolves npm .cmd shims on Windows without passing model or
    // workspace arguments through a shell assembled by this application.
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout!.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr!.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${command} timed out after ${timeoutMs} ms.`));
      else resolve({ code, stdout, stderr });
    });
    // A CLI may reject arguments before reading stdin. Preserve its actual
    // exit status and stderr instead of crashing on the resulting EPIPE.
    child.stdin!.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") reject(error);
    });
    child.stdin!.end(input);
  });
}

async function available(command: string): Promise<boolean> {
  try { return (await run(command, ["--version"], process.cwd(), "", 5_000)).code === 0; } catch { return false; }
}

async function authenticated(command: string, statusArgs: string[]): Promise<boolean> {
  if (!await available(command)) return false;
  try { return (await run(command, statusArgs, process.cwd(), "", 10_000)).code === 0; } catch { return false; }
}

async function cursorInstalledCommands(): Promise<string[]> {
  const commands: string[] = [];
  for (const command of ["cursor-agent", "agent"]) {
    if (command === "agent") {
      try {
        const help = await run(command, ["--help"], process.cwd(), "", 5_000);
        if (help.code !== 0 || !/Cursor Agent/iu.test(`${help.stdout}\n${help.stderr}`)) continue;
      } catch { continue; }
    }
    if (await available(command)) commands.push(command);
  }
  return commands;
}

async function cursorCommand(): Promise<string | undefined> {
  for (const command of await cursorInstalledCommands()) {
    if (await authenticated(command, ["status"])) return command;
  }
  return undefined;
}

export async function resolveInferenceProvider(config: AiReviewConfig): Promise<InferenceProviderId | undefined> {
  if (config.provider === "http" || (config.provider === "auto" && !config.frameworks.length && config.endpoint)) return "http";
  const requested = config.provider === "auto" ? config.frameworks : [config.provider];
  for (const provider of requested) {
    if (provider === "codex" && await authenticated("codex", ["login", "status"])) return "codex";
    if (provider === "claude-code" && await authenticated("claude", ["auth", "status"])) return "claude-code";
    if (provider === "cursor" && await cursorCommand()) return "cursor";
  }
  return undefined;
}

function parseModels(output: string): AvailableModel[] {
  const models: AvailableModel[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.trim().match(/^([^\s]+)\s+-\s+(.+)$/u);
    if (match?.[1] && match[2] && !models.some((item) => item.id === match[1])) {
      models.push({ id: match[1], label: match[2] });
    }
  }
  return models;
}

export async function discoverAvailableModels(provider: InferenceProviderId, endpoint?: string, apiKeyEnv?: string): Promise<AvailableModel[]> {
  if (provider === "codex") {
    try {
      const result = await run("codex", ["debug", "models"], process.cwd(), "", 15_000);
      if (result.code !== 0) return [];
      const payload = JSON.parse(result.stdout) as { models?: Array<{ slug?: string; display_name?: string; visibility?: string }> };
      const visible = (payload.models ?? []).flatMap((model) =>
        model.slug && model.visibility !== "hide"
          ? [{ id: model.slug, label: model.display_name ?? model.slug }]
          : []
      );
      return [...new Map(visible.map((model) => [model.id, model])).values()];
    } catch {
      return [];
    }
  }
  if (provider === "cursor") {
    const command = await cursorCommand();
    if (!command) return [];
    try {
      const result = await run(command, ["--list-models"], process.cwd(), "", 15_000);
      return result.code === 0 ? parseModels(result.stdout) : [];
    } catch {
      return [];
    }
  }
  if (provider === "http" && endpoint) {
    try {
      const modelsUrl = endpoint.replace(/\/chat\/completions\/?$/u, "/models");
      const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : undefined;
      const headers: Record<string, string> = {};
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const response = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return [];
      const payload = await response.json() as { data?: Array<{ id?: string }> };
      return (payload.data ?? []).flatMap((item) => item.id ? [{ id: item.id, label: item.id }] : []);
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonText(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*|\s*```$/gu, "");
  try { return JSON.parse(trimmed); } catch {
    for (const line of trimmed.split(/\r?\n/u).reverse()) {
      try { return JSON.parse(line.trim()); } catch { /* Cursor may prefix a JSON line with CLI notices. */ }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Inference framework did not return JSON.");
  }
}

function parseProviderJson(label: string, value: string): unknown {
  try { return parseJsonText(value); }
  catch { throw new Error(`${label} inference returned invalid JSON. Try another model or a different review provider.`); }
}

function failure(label: string, result: ProcessResult): Error {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`;
  return new Error(`${label} inference failed: ${detail.slice(-500)}`);
}

function prompt(system: string, input: string): string {
  return `SYSTEM INSTRUCTIONS\n${system}\n\nINPUT DATA\n${input}`;
}

function codexRuntime(config: AiReviewConfig): InferenceRuntime {
  return {
    name: "codex",
    async generate(schemaName, schema, system, input) {
      const directory = await mkdtemp(join(tmpdir(), "harnessme-codex-"));
      try {
        const schemaPath = join(directory, `${schemaName}.schema.json`);
        const outputPath = join(directory, `${schemaName}.json`);
        await writeFile(schemaPath, JSON.stringify(schema), "utf8");
        const args = ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", "--output-schema", schemaPath, "--output-last-message", outputPath, "-C", directory];
        if (config.model) args.push("--model", config.model);
        if (config.reasoningEffort) args.push("-c", `model_reasoning_effort=${config.reasoningEffort}`);
        args.push("-");
        // Deep repository analysis and council review can legitimately exceed
        // two minutes on large context windows. Keep the process bounded while
        // allowing the selected reasoning effort to finish.
        const result = await run("codex", args, directory, prompt(system, input), 600_000);
        if (result.code !== 0) throw failure("Codex", result);
        return parseProviderJson("Codex", await readFile(outputPath, "utf8"));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

function claudeRuntime(config: AiReviewConfig): InferenceRuntime {
  return {
    name: "claude-code",
    async generate(_schemaName, schema, system, input) {
      const directory = await mkdtemp(join(tmpdir(), "harnessme-claude-"));
      try {
        const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--permission-mode", "plan"];
        if (config.model) args.push("--model", config.model);
        const result = await run("claude", args, directory, prompt(system, input), 600_000);
        if (result.code !== 0) throw failure("Claude Code", result);
        const payload = parseProviderJson("Claude Code", result.stdout) as { is_error?: boolean; structured_output?: unknown; result?: string };
        if (payload.is_error) throw new Error(`Claude Code inference failed: ${String(payload.result ?? "unknown error").slice(-500)}`);
        const output = payload.structured_output ?? payload.result ?? payload;
        return typeof output === "string" ? parseProviderJson("Claude Code", output) : output;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

function cursorRuntime(config: AiReviewConfig, command = "cursor-agent"): InferenceRuntime {
  return {
    name: "cursor",
    async generate(_schemaName, schema, system, input) {
      const directory = await mkdtemp(join(tmpdir(), "harnessme-cursor-"));
      try {
        const inputPath = join(directory, "input.txt");
        await writeFile(inputPath, `${prompt(system, input)}\n\nOUTPUT JSON SCHEMA\n${JSON.stringify(schema)}`, "utf8");
        const args = ["--print", "--mode", "ask", "--output-format", "json", "--trust", "--workspace", directory];
        if (config.model) args.push("--model", config.model);
        args.push("Read input.txt and return only JSON matching its OUTPUT JSON SCHEMA. Do not modify files or run commands.");
        const result = await run(command, args, directory, "", 600_000);
        if (result.code !== 0) throw failure("Cursor", result);
        const payload = parseProviderJson("Cursor", result.stdout) as { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown };
        if (payload.is_error || payload.subtype === "error") throw new Error(`Cursor inference failed: ${String(payload.result ?? "unknown error").slice(-500)}`);
        const output = payload.structured_output ?? payload.result ?? payload;
        return typeof output === "string" ? parseProviderJson("Cursor", output) : output;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

function httpRuntime(config: AiReviewConfig): InferenceRuntime {
  if (!config.endpoint || !config.model) throw new Error("HTTP inference requires an endpoint and model.");
  return {
    name: "http",
    async generate(schemaName, schema, system, input) {
      const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
      if (config.apiKeyEnv && !apiKey) throw new Error(`AI fallback requires environment variable ${config.apiKeyEnv}.`);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const response = await fetch(config.endpoint!, {
        method: "POST", headers, signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: system }, { role: "user", content: input }], response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } } }),
      });
      if (!response.ok) throw new Error(`AI fallback request failed (${response.status} ${response.statusText}).`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI fallback returned no structured response.");
      return parseProviderJson("HTTP", content);
    },
  };
}

function observed(runtime: InferenceRuntime, observer?: InferenceObserver): InferenceRuntime {
  if (!observer) return runtime;
  return {
    name: runtime.name,
    async generate(stage, schema, system, input) {
      const started = performance.now();
      const emit = (status: InferenceEvent["status"]): void => observer({
        provider: runtime.name, stage, status, elapsedMs: Math.round(performance.now() - started),
      });
      emit("started");
      const heartbeat = setInterval(() => emit("waiting"), 30_000);
      heartbeat.unref();
      try {
        const output = await runtime.generate(stage, schema, system, input);
        emit("completed");
        return output;
      } catch (error) {
        emit("failed");
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    },
  };
}

export async function createInferenceRuntime(config: AiReviewConfig, observer?: InferenceObserver): Promise<InferenceRuntime> {
  const resolved = await resolveInferenceProvider(config);
  if (resolved === "http") return observed(httpRuntime(config), observer);
  if (resolved === "codex") return observed(codexRuntime(config), observer);
  if (resolved === "claude-code") return observed(claudeRuntime(config), observer);
  if (resolved === "cursor") {
    return observed(cursorRuntime(config, (await cursorCommand())!), observer);
  }
  const requested = config.provider === "auto" ? config.frameworks : [config.provider];
  throw new InferenceUnavailableError(`No authenticated inference CLI is available for: ${requested.join(", ") || "the selected providers"}. Install/login to one or use --provider=http.`);
}

export async function diagnoseInferenceProvider(
  provider: InferenceProviderId,
  options: { endpoint?: string; apiKeyEnv?: string; model?: string; probe?: boolean } = {},
): Promise<ProviderDiagnosis> {
  let command = provider === "codex" ? "codex" : provider === "claude-code" ? "claude" : provider === "cursor"
    ? (await cursorInstalledCommands())[0] : undefined;
  const installed = provider === "http" ? Boolean(options.endpoint) : Boolean(command && await available(command));
  const config: AiReviewConfig = {
    provider, frameworks: provider === "http" ? [] : [provider], endpoint: options.endpoint,
    model: options.model, apiKeyEnv: options.apiKeyEnv ?? "",
  };
  const authenticated = provider === "http"
    ? installed && (!options.apiKeyEnv || Boolean(process.env[options.apiKeyEnv]))
    : Boolean(await resolveInferenceProvider(config));
  if (provider === "cursor" && authenticated) command = await cursorCommand();
  const models = authenticated ? await discoverAvailableModels(provider, options.endpoint, options.apiKeyEnv) : [];
  const diagnosis: ProviderDiagnosis = {
    provider, command, installed, authenticated, models,
    modelDiscovery: !authenticated ? "failed" : provider === "claude-code" ? "unsupported" : models.length ? "available" : "failed",
  };
  if (options.probe) {
    const started = performance.now();
    try {
      if (!authenticated) throw new Error("Provider is not installed or authenticated.");
      if (provider === "http" && !options.model) throw new Error("HTTP probing requires --model.");
      const runtime = await createInferenceRuntime(config);
      const result = await runtime.generate("harnessme_provider_probe", {
        type: "object", additionalProperties: false,
        properties: { ok: { type: "boolean" } }, required: ["ok"],
      }, "Return JSON with ok set to true.", "Provider diagnostic probe.");
      if (typeof result !== "object" || result === null || (result as { ok?: unknown }).ok !== true) {
        throw new Error("Structured response did not contain ok: true.");
      }
      diagnosis.probe = { ok: true, elapsedMs: Math.round(performance.now() - started) };
    } catch (error) {
      diagnosis.probe = {
        ok: false, elapsedMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return diagnosis;
}
