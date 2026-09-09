import { spawn } from "node:child_process";
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

interface ProcessResult { code: number | null; stdout: string; stderr: string }

function executable(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

async function run(command: string, args: string[], cwd: string, input = "", timeoutMs = 120_000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable(command), args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

async function available(command: string): Promise<boolean> {
  try { return (await run(command, ["--version"], process.cwd(), "", 5_000)).code === 0; } catch { return false; }
}

export async function resolveInferenceProvider(config: AiReviewConfig): Promise<InferenceProviderId | undefined> {
  if (config.provider === "http" || (config.provider === "auto" && !config.frameworks.length && config.endpoint)) return "http";
  const requested = config.provider === "auto" ? config.frameworks : [config.provider];
  for (const provider of requested) {
    if (provider === "codex" && await available("codex")) return "codex";
    if (provider === "claude-code" && await available("claude")) return "claude-code";
    if (provider === "cursor" && (await available("cursor-agent") || await available("agent"))) return "cursor";
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
    const command = await available("cursor-agent") ? "cursor-agent" : "agent";
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
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Inference framework did not return JSON.");
  }
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
        if (result.code !== 0) throw new Error(`Codex inference failed: ${result.stderr.trim().slice(-500)}`);
        return parseJsonText(await readFile(outputPath, "utf8"));
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
        if (result.code !== 0) throw new Error(`Claude Code inference failed: ${result.stderr.trim().slice(-500)}`);
        const payload = parseJsonText(result.stdout) as { structured_output?: unknown; result?: string };
        return payload.structured_output ?? (typeof payload.result === "string" ? parseJsonText(payload.result) : payload);
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
        if (result.code !== 0) throw new Error(`Cursor inference failed: ${result.stderr.trim().slice(-500)}`);
        const payload = parseJsonText(result.stdout) as { result?: string; structured_output?: unknown };
        return payload.structured_output ?? (typeof payload.result === "string" ? parseJsonText(payload.result) : payload);
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
      return parseJsonText(content);
    },
  };
}

export async function createInferenceRuntime(config: AiReviewConfig): Promise<InferenceRuntime> {
  const resolved = await resolveInferenceProvider(config);
  if (resolved === "http") return httpRuntime(config);
  if (resolved === "codex") return codexRuntime(config);
  if (resolved === "claude-code") return claudeRuntime(config);
  if (resolved === "cursor") {
    if (await available("cursor-agent")) return cursorRuntime(config, "cursor-agent");
    return cursorRuntime(config, "agent");
  }
  const requested = config.provider === "auto" ? config.frameworks : [config.provider];
  throw new InferenceUnavailableError(`No authenticated inference CLI is available for: ${requested.join(", ") || "the selected providers"}. Install/login to one or use --provider=http.`);
}
