import {
  SelectRenderableEvents,
  createCliRenderer,
  type CliRenderer,
  type SelectOption,
} from "@opentui/core";
import { readFacts } from "@harnessme/core";
import initCommand from "../commands/init.js";
import refreshCommand from "../commands/refresh.js";
import qualityCommand from "../commands/quality.js";
import syncCommand from "../commands/sync.js";
import { activate as activateCriticalCommand, list as listCriticalCommand, remove as removeCriticalCommand } from "../commands/critical.js";
import { configureInference, removeHarnessState, resolveInferenceChoice, runDashboardCommand, type InferenceChoice, type OperationOutput } from "./actions.js";
import { loadDashboardState } from "./state.js";
import { buildDashboard, buildOperationScreen, buildSelectionScreen } from "./view.js";

type Operation = (onOutput: OperationOutput) => Promise<void>;

interface Action {
  label: string;
  description: string;
  prepare: () => Promise<Operation | undefined>;
}

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

async function showOperation(title: string, operation: (onOutput: OperationOutput) => Promise<void>): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const screen = buildOperationScreen(renderer, title);
  let message = "Operation complete. Press any key to return to the dashboard.";
  try {
    await operation(screen.append);
    screen.append(`\n✓ ${message}\n`);
  } catch (error) {
    message = "Operation failed. Press any key to return to the dashboard.";
    screen.append(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  }
  screen.finish(message);
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

async function chooseGate(root: string, status: "active" | "proposed", verb: "activate" | "remove"): Promise<string | undefined> {
  const facts = await readFacts(root);
  const gates = facts.criticalPaths.paths.filter((gate) => gate.status === status);
  if (!gates.length) throw new Error(`No ${status} critical gates are available to ${verb}.`);
  const selected = await selectOption(
    `${verb === "activate" ? "Activate" : "Remove"} critical gate`,
    verb === "activate"
      ? "AI-recognized candidates become protected: agents must ask before editing them."
      : "Removing this protection lets agents edit the path without the critical-change gate.",
    gates.map((gate) => ({ name: gate.glob, description: `${gate.risk ?? "other"}: ${gate.reason}`, value: gate.glob })),
  );
  if (!selected) return undefined;
  if (verb === "remove") {
    const confirmed = await selectOption(
      `Remove gate for ${selected.value as string}?`,
      "This removes the pre-edit confirmation and Git approval requirement for this path.",
      [
        { name: "Cancel", description: "Keep the critical protection.", value: false },
        { name: "Remove gate", description: "Remove this path from critical protection.", value: true },
      ],
    );
    if (confirmed?.value !== true) return undefined;
  }
  return selected.value as string;
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
      { label: "Refresh with AI", description: "Use the configured provider and model.", prepare: async () => async (onOutput) => runDashboardCommand(root, refreshCommand, { deterministic: false }, onOutput) },
      { label: "Refresh deterministically", description: "Run without model inference for this refresh.", prepare: async () => async (onOutput) => runDashboardCommand(root, refreshCommand, { deterministic: true }, onOutput) },
      { label: "Change provider / model", description: "Select inference settings, then regenerate the harness.", prepare: async () => {
        const choice = await chooseInference();
        if (!choice) return undefined;
        return async (onOutput) => {
          await configureInference(root, choice);
          await runDashboardCommand(root, refreshCommand, { deterministic: choice.deterministic }, onOutput);
        };
      } },
      { label: "Quality report", description: "Inspect evidence-backed harness quality checks.", prepare: async () => async (onOutput) => runDashboardCommand(root, qualityCommand, {}, onOutput) },
      { label: "Critical gates", description: "List active and AI-proposed protected paths.", prepare: async () => async (onOutput) => runDashboardCommand(root, listCriticalCommand, {}, onOutput) },
      { label: "Activate AI-proposed gate", description: "Protect a recognized core path and require pre-edit confirmation.", prepare: async () => {
        const glob = await chooseGate(root, "proposed", "activate");
        return glob ? async (onOutput) => runDashboardCommand(root, activateCriticalCommand, { glob }, onOutput) : undefined;
      } },
      { label: "Remove critical gate", description: "Remove protection from an active core path after confirmation.", prepare: async () => {
        const glob = await chooseGate(root, "active", "remove");
        return glob ? async (onOutput) => runDashboardCommand(root, removeCriticalCommand, { glob }, onOutput) : undefined;
      } },
      { label: "Sync integrations", description: "Regenerate provider files from stored facts.", prepare: async () => async (onOutput) => runDashboardCommand(root, syncCommand, {}, onOutput) },
      { label: "Delete harness state", description: "Remove .harnessme after confirmation.", prepare: async () => {
        if (!await confirmRemoval()) return undefined;
        return async () => removeHarnessState(root);
      } },
      { label: "Exit", description: "Close the dashboard.", prepare: async () => { running = false; return undefined; } },
    ] : [
      { label: "Initialize", description: "Analyze this repository and create its harness.", prepare: async () => {
        const choice = await chooseInference();
        if (!choice) return undefined;
        return async (onOutput) => runDashboardCommand(root, initCommand, {
          provider: choice.provider ?? "auto",
          deterministic: choice.deterministic,
          model: choice.model,
          councilSize: "2",
          aiApiKeyEnv: "",
          aiInclude: "**/*",
          reviewAiApiKeyEnv: "",
          criticalApprovers: "developer",
        }, onOutput);
      } },
      { label: "Exit", description: "Close the dashboard.", prepare: async () => { running = false; return undefined; } },
    ];
    const selected = await dashboardSelection(root, actions);
    if (!selected) break;
    const operation = await selected.prepare();
    if (running && operation) await showOperation(selected.label, operation);
  }
}
