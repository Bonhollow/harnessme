import { rm } from "node:fs/promises";
import { join } from "node:path";
import { discoverAvailableModels, resolveInferenceProvider, type InferenceProviderId } from "@harnessme/analyzers";
import { harnessDir, readFacts, writeYaml, type AiFallbackConfig } from "@harnessme/core";
import { withOutputSink } from "../output.js";

export interface InferenceChoice {
  deterministic: boolean;
  provider?: InferenceProviderId;
  model?: string;
}

export type OperationOutput = (chunk: string) => void;

export interface DashboardCommand {
  run?: (...arguments_: any[]) => unknown;
}

export async function resolveInferenceChoice(
  requested: "auto" | "codex" | "claude-code" | "cursor",
): Promise<{ provider: InferenceProviderId; models: Array<{ id: string; label: string }> }> {
  const provider = await resolveInferenceProvider({
    provider: requested,
    frameworks: requested === "auto" ? ["codex", "claude-code", "cursor"] : [requested],
    apiKeyEnv: "",
  });
  if (!provider) throw new Error(`No installed and authenticated ${requested === "auto" ? "inference provider" : requested} was found.`);
  const models = await discoverAvailableModels(provider);
  return { provider, models };
}

export async function configureInference(root: string, choice: InferenceChoice): Promise<void> {
  const facts = await readFacts(root);
  if (choice.deterministic) {
    facts.config.analysis.aiFallback = undefined;
  } else if (choice.provider) {
    const previous = facts.config.analysis.aiFallback;
    const frameworks = choice.provider === "http" ? [] : [choice.provider];
    const config: AiFallbackConfig = {
      enabled: true,
      provider: choice.provider,
      frameworks,
      model: choice.model,
      apiKeyEnv: previous?.apiKeyEnv ?? "",
      maxFiles: previous?.maxFiles ?? 40,
      maxFileBytes: previous?.maxFileBytes ?? 65_536,
      include: previous?.include ?? ["**/*"],
      exclude: previous?.exclude ?? [],
    };
    facts.config.analysis.aiFallback = config;
  }
  await writeYaml(join(harnessDir(root), "harnessme.yaml"), facts.config);
}

export async function runDashboardCommand(
  root: string,
  command: DashboardCommand,
  args: Record<string, unknown>,
  onOutput: OperationOutput = () => {},
): Promise<void> {
  if (!command.run) throw new Error("This HarnessME command cannot run in the dashboard.");
  await withOutputSink({
    info: (message) => onOutput(`${message}\n`),
    warn: (message) => onOutput(`warning: ${message}\n`),
    progress: (current, total, message, complete) => onOutput(`${complete ? "✓" : "…"} [${current}/${total}] ${message}\n`),
    panel: (title, lines) => onOutput(`${title}\n${lines.map((line) => `  ${line}`).join("\n")}\n`),
  }, async () => {
    await command.run?.({ args: { ...args, root }, rawArgs: {}, cmd: command });
  });
}

export async function removeHarnessState(root: string): Promise<void> {
  await rm(harnessDir(root), { recursive: true, force: true });
}
