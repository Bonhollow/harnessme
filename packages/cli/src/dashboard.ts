import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { exists, harnessDir, readFacts } from "@harnessme/core";
import { panel, terminalUiEnabled } from "./output.js";

async function ask(prompt: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return (await prompt.question(question)).trim();
}

export async function dashboard(root = process.cwd()): Promise<void> {
  if (!terminalUiEnabled()) {
    stdout.write("Run `harnessme init`, `harnessme refresh`, or `harnessme --help`. The dashboard requires an interactive terminal.\n");
    return;
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const initialized = await exists(harnessDir(root));
    const facts = initialized ? await readFacts(root) : undefined;
    panel("HarnessME dashboard", [
      `Repository: ${root}`, `Harness: ${initialized ? "installed" : "not initialized"}`,
      ...(facts ? [`Quality: ${facts.quality?.score ?? "not measured"}/100`, `Mode: ${facts.generation?.status ?? "deterministic"}`] : []),
    ]);
    stdout.write(initialized
      ? "\n1. Refresh harness\n2. Show quality\n3. List critical gates\n4. Delete harness\n5. Exit\n"
      : "\n1. Initialize harness\n2. Exit\n");
    const choice = await ask(prompt, "Select an action: ");
    if (!initialized && choice === "1") {
      stdout.write("Run `harnessme init --provider codex` to choose a provider and model.\n");
    } else if (initialized && choice === "1") {
      stdout.write("Run `harnessme refresh` to preserve your current provider and council settings.\n");
    } else if (initialized && choice === "2") {
      stdout.write("Run `harnessme quality` for the full evidence report.\n");
    } else if (initialized && choice === "3") {
      stdout.write("Run `harnessme critical list` to inspect active and proposed gates.\n");
    } else if (initialized && choice === "4") {
      const confirmation = await ask(prompt, "Type DELETE to remove .harnessme only (generated agent files are retained): ");
      if (confirmation === "DELETE") stdout.write("For safety, dashboard deletion is not enabled yet. Run `rm -rf .harnessme` only after reviewing generated files.\n");
      else stdout.write("Deletion cancelled.\n");
    }
  } finally { prompt.close(); }
}
