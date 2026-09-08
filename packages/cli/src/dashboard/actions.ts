import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { discoverAvailableModels, resolveInferenceProvider, type InferenceProviderId } from "@harnessme/analyzers";
import { harnessDir, readFacts, writeYaml, type AiFallbackConfig } from "@harnessme/core";

export interface InferenceChoice {
  deterministic: boolean;
  provider?: InferenceProviderId;
  model?: string;
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

export async function runCli(root: string, args: string[]): Promise<void> {
  const entry = process.argv[1];
  if (!entry) throw new Error("Cannot locate the HarnessME executable.");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args, "--root", root], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`HarnessME command exited with code ${code ?? 1}.`)));
  });
}

export async function removeHarnessState(root: string): Promise<void> {
  await rm(harnessDir(root), { recursive: true, force: true });
}
