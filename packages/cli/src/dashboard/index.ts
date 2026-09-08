import {
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type SelectOption,
} from "@opentui/core";
import { configureInference, removeHarnessState, resolveInferenceChoice, runCli, type InferenceChoice } from "./actions.js";
import { loadDashboardState } from "./state.js";
import { buildDashboard, buildSelectionScreen } from "./view.js";

interface Action { label: string; description: string; run: () => Promise<void> }

async function selectOption(
  title: string,
  description: string,
  options: SelectOption[],
): Promise<SelectOption | undefined> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const select = buildSelectionScreen(renderer, title, description, options);
  return new Promise((resolve) => {
    let done = false;
    const finish = (option?: SelectOption): void => {
      if (done) return;
      done = true;
      renderer.destroy();
      resolve(option);
    };
    select.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option: SelectOption) => finish(option));
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) finish();
    });
  });
}

async function chooseInference(): Promise<InferenceChoice | undefined> {
  const selected = await selectOption("Inference", "Choose the runtime used to author and review the harness.", [
    { name: "Auto detect", description: "Use the first authenticated framework CLI.", value: "auto" },
    { name: "Codex", description: "Use the authenticated Codex CLI.", value: "codex" },
    { name: "Claude Code", description: "Use the authenticated Claude CLI.", value: "claude-code" },
    { name: "Cursor", description: "Use the authenticated Cursor agent CLI.", value: "cursor" },
    { name: "Deterministic only", description: "Disable model inference.", value: "deterministic" },
  ]);
  if (!selected) return undefined;
  if (selected.value === "deterministic") return { deterministic: true };
  const resolved = await resolveInferenceChoice(selected.value as "auto" | "codex" | "claude-code" | "cursor");
  if (!resolved.models.length) return { deterministic: false, provider: resolved.provider };
  const model = await selectOption("Model", `Choose the ${resolved.provider} model.`, [
    ...resolved.models.map((item) => ({ name: item.label, description: item.id, value: item.id })),
    { name: "Provider default", description: "Let the framework select its default model.", value: undefined },
  ]);
  if (!model) return undefined;
  return { deterministic: false, provider: resolved.provider, model: model.value as string | undefined };
}

async function showMessage(title: string, message: string): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const text = new TextRenderable(renderer, {
    content: `${title}\n\n${message}\n\nPress any key to return.`,
    fg: "#e2e8f0",
    bg: "#0b1020",
    width: "100%",
    height: "100%",
    padding: 2,
  });
  renderer.root.add(text);
  await new Promise<void>((resolve) => renderer.keyInput.once("keypress", () => resolve()));
  renderer.destroy();
}

async function confirmRemoval(): Promise<boolean> {
  const selected = await selectOption(
    "Delete HarnessME state?",
    "This removes .harnessme. Generated integration files remain for manual review.",
    [
      { name: "Cancel", description: "Keep the current harness.", value: false },
      { name: "Delete .harnessme", description: "Remove stored configuration, evidence, approvals, and history.", value: true },
    ],
  );
  return selected?.value === true;
}

async function dashboardSelection(root: string, actions: Action[]): Promise<Action | undefined> {
  const renderer: CliRenderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const state = await loadDashboardState(root);
  const select = buildDashboard(renderer, state, actions.map((action, index) => ({
    name: action.label,
    description: action.description,
    value: index,
  })));
  return new Promise((resolve) => {
    let done = false;
    const finish = (action?: Action): void => {
      if (done) return;
      done = true;
      renderer.destroy();
      resolve(action);
    };
    select.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option: SelectOption) => finish(actions[Number(option.value)]));
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) finish();
    });
  });
}

export async function openDashboard(root = process.cwd()): Promise<void> {
  let running = true;
  while (running) {
    const state = await loadDashboardState(root);
    const actions: Action[] = state.initialized ? [
      { label: "Refresh with AI", description: "Use the configured provider and model.", run: async () => runCli(root, ["refresh"]) },
      { label: "Refresh deterministically", description: "Run without model inference for this refresh.", run: async () => runCli(root, ["refresh", "--deterministic"]) },
      { label: "Change provider / model", description: "Select inference settings, then regenerate the harness.", run: async () => {
        const choice = await chooseInference();
        if (!choice) return;
        await configureInference(root, choice);
        await runCli(root, choice.deterministic ? ["refresh", "--deterministic"] : ["refresh"]);
      } },
      { label: "Quality report", description: "Inspect evidence-backed harness quality checks.", run: async () => runCli(root, ["quality"]) },
      { label: "Critical gates", description: "List active and proposed protected paths.", run: async () => runCli(root, ["critical", "list"]) },
      { label: "Sync integrations", description: "Regenerate provider files from stored facts.", run: async () => runCli(root, ["sync"]) },
      { label: "Delete harness state", description: "Remove .harnessme after confirmation.", run: async () => { if (await confirmRemoval()) await removeHarnessState(root); } },
      { label: "Exit", description: "Close the dashboard.", run: async () => { running = false; } },
    ] : [
      { label: "Initialize", description: "Analyze this repository and create its harness.", run: async () => {
        const choice = await chooseInference();
        if (!choice) return;
        const args = choice.deterministic
          ? ["init", "--deterministic"]
          : ["init", "--provider", choice.provider ?? "auto", ...(choice.model ? ["--model", choice.model] : [])];
        await runCli(root, args);
      } },
      { label: "Exit", description: "Close the dashboard.", run: async () => { running = false; } },
    ];
    const selected = await dashboardSelection(root, actions);
    if (!selected) break;
    try {
      await selected.run();
      if (running && selected.label !== "Delete harness state") await showMessage("Operation complete", "The dashboard state will now be refreshed.");
    } catch (error) {
      await showMessage("Operation failed", error instanceof Error ? error.message : String(error));
    }
  }
}
