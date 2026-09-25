import { defineCommand } from "citty";
import { diagnoseInferenceProvider, type InferenceProviderId } from "@harnessme/analyzers";
import { info } from "../output.js";

const list = defineCommand({
  meta: { name: "list", description: "List model-inference providers" },
  run() {
    info("auto           First available authenticated framework CLI");
    info("codex          OpenAI Codex CLI");
    info("claude-code    Claude Code CLI (alias: claude)");
    info("cursor         Cursor Agent CLI");
    info("http           OpenAI-compatible chat-completions endpoint");
  },
});

const doctor = defineCommand({
  meta: { name: "doctor", description: "Check provider installation, login, model catalog, and optional structured output" },
  args: {
    provider: { type: "string", description: "Provider to check: all, codex, claude-code, cursor, or http", default: "all" },
    probe: { type: "boolean", description: "Make a small live structured-output inference call" },
    model: { type: "string", description: "Model for the optional probe" },
    endpoint: { type: "string", description: "Chat-completions endpoint for HTTP" },
    "api-key-env": { type: "string", description: "Environment variable containing the HTTP API key" },
  },
  async run({ args }) {
    const selected = args.provider === "claude" ? "claude-code" : args.provider;
    const valid = ["all", "codex", "claude-code", "cursor", "http"];
    if (!valid.includes(selected)) throw new Error(`--provider must be ${valid.join(", ")}.`);
    const providers: InferenceProviderId[] = selected === "all"
      ? ["codex", "claude-code", "cursor", ...(args.endpoint ? ["http" as const] : [])]
      : [selected as InferenceProviderId];
    const results = await Promise.all(providers.map((provider) => diagnoseInferenceProvider(provider, {
      endpoint: typeof args.endpoint === "string" ? args.endpoint : undefined,
      apiKeyEnv: typeof args.apiKeyEnv === "string" ? args.apiKeyEnv : undefined,
      model: typeof args.model === "string" ? args.model : undefined,
      probe: Boolean(args.probe),
    })));
    for (const result of results) {
      const installation = result.installed ? `installed${result.command ? ` (${result.command})` : ""}` : "missing";
      const login = result.authenticated ? "ready" : result.installed ? "not authenticated" : "unavailable";
      const models = result.modelDiscovery === "available" ? `${result.models.length} model(s)`
        : result.modelDiscovery === "unsupported" ? "catalog unsupported" : "catalog unavailable";
      info(`${result.provider}: ${installation}; ${login}; ${models}`);
      if (result.models.length) info(`  models: ${result.models.map((model) => model.id).join(", ")}`);
      if (result.probe) info(`  structured probe: ${result.probe.ok ? "passed" : `failed (${result.probe.error})`} in ${(result.probe.elapsedMs / 1000).toFixed(1)}s`);
    }
    const healthy = results.some((result) => result.authenticated && (!args.probe || result.probe?.ok));
    if (!healthy) throw new Error("No checked provider is ready. Install/login to a CLI, or fix the HTTP endpoint and credentials.");
  },
});

export default defineCommand({
  meta: { name: "providers", description: "Inspect model-inference providers" },
  subCommands: { list, doctor },
});
