import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { AvailableModel, InferenceProviderId } from "@harnessme/analyzers";
import { info, panel, terminalUiEnabled } from "./output.js";

export async function selectModel(
  provider: InferenceProviderId,
  available: AvailableModel[],
  supplied?: string,
): Promise<string | undefined> {
  if (supplied || !stdin.isTTY || !stdout.isTTY) return supplied;
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    if (terminalUiEnabled()) panel("HarnessME model selection", [
      `Provider: ${provider}`,
      available.length ? "Choose an available model or enter a custom ID." : "Enter a model ID, or use the provider default.",
    ]);
    if (!available.length) {
      const answer = (await prompt.question(`Model for ${provider} (Enter = provider default, or type a model ID): `)).trim();
      return answer || undefined;
    }
    info(`Available ${provider} models:`);
    available.forEach((model, index) => info(`  ${index + 1}. ${model.label} (${model.id})`));
    info(`  ${available.length + 1}. Custom model ID`);
    const answer = (await prompt.question("Select model [1]: ")).trim();
    const selection = answer ? Number.parseInt(answer, 10) : 1;
    if (selection >= 1 && selection <= available.length) return available[selection - 1]?.id;
    if (selection === available.length + 1) {
      const custom = (await prompt.question("Model ID: ")).trim();
      return custom || undefined;
    }
    throw new Error("Invalid model selection.");
  } finally {
    prompt.close();
  }
}
