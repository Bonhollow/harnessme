import {
  SelectRenderableEvents,
  createCliRenderer,
  type CliRenderer,
  type SelectOption,
} from "@opentui/core";
import initCommand from "../commands/init.js";
import refreshCommand from "../commands/refresh.js";
import syncCommand from "../commands/sync.js";
import { activate as activateCriticalCommand, add as addCriticalCommand, remove as removeCriticalCommand } from "../commands/critical.js";
import { configureInference, removeHarnessState, resolveInferenceChoice, runDashboardCommand, type InferenceChoice, type OperationOutput } from "./actions.js";
import { manageGates } from "./gates.js";
import { collectProjectDetails } from "./details.js";
import { loadQualityReport } from "./quality.js";
import { loadDashboardState } from "./state.js";
import { buildDashboard, buildOperationScreen, buildQualityReportScreen, buildSelectionScreen } from "./view.js";

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
  if (!resolved.models.length) return chooseThinkingLevel({ deterministic: false, provider: resolved.provider });
  const model = await selectOption("Model · 2/4", `Choose the ${resolved.provider} model.`, [
    ...resolved.models.map((item) => ({ name: item.label, description: item.id, value: item.id })),
    { name: "Provider default", description: "Let the framework select its default model.", value: undefined },
  ]);
  if (!model) return undefined;
  return chooseThinkingLevel({ deterministic: false, provider: resolved.provider, model: model.value as string | undefined });
}

async function chooseThinkingLevel(choice: InferenceChoice): Promise<InferenceChoice | undefined> {
  if (choice.provider !== "codex") return choice;
  const level = await selectOption("Thinking level · 3/4", "Choose how deeply Codex reasons before authoring and reviewing the harness. Higher effort may take longer.", [
    { name: "Balanced (recommended)", description: "Strong reasoning for repository architecture without unnecessary latency.", value: "medium" },
    { name: "Fast", description: "Lower latency for small or straightforward repositories.", value: "low" },
    { name: "Deep", description: "More deliberate architecture and safety analysis for complex repositories.", value: "high" },
  ]);
  return level ? { ...choice, reasoningEffort: level.value as "low" | "medium" | "high" } : undefined;
}

interface InitSettings extends InferenceChoice { councilSize: string; details?: string }

async function chooseInitSettings(): Promise<InitSettings | undefined> {
  const choice = await chooseInference();
  if (!choice) return undefined;
  const council = choice.deterministic ? undefined : await selectOption(
    "Harness review · 4/5",
    "Choose how many independent AI reviewers compare the authored harness against repository evidence.",
    [
      { name: "Balanced review (recommended)", description: "Two independent review candidates; a strong default for most repositories.", value: "2" },
      { name: "Fast review", description: "One reviewer candidate; lower latency and inference usage.", value: "1" },
      { name: "Maximum review", description: "Three independent candidates; strongest challenge of architecture and gate claims.", value: "3" },
    ],
  );
  if (!choice.deterministic && !council) return undefined;
  const councilSize = choice.deterministic ? "1" : String(council?.value);
  const details = await collectProjectDetails("Project details · optional · 5/5");
  if (details === null) return undefined;
  const summary = choice.deterministic
    ? "Local deterministic analysis only. No model inference will run."
    : `AI inference: ${choice.provider ?? "auto"} / ${choice.model ?? "provider default"}\nThinking: ${choice.reasoningEffort ?? "provider default"}\nReview council: ${councilSize} candidate(s)`;
  const confirmed = await selectOption(
    "Ready to create the harness",
    `${summary}\n\nThe dashboard will show real-time analysis, authorship, review, gate detection, and rendering progress.`,
    [
      { name: "Start initialization", description: "Create the governed agent harness in this repository.", value: true },
      { name: "Back", description: "Return to the dashboard without changing the repository.", value: false },
    ],
  );
  return confirmed?.value === true ? { ...choice, councilSize, details } : undefined;
}

async function showOperation(title: string, operation: (onOutput: OperationOutput) => Promise<void>): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const screen = buildOperationScreen(renderer, title);
  let message = "Operation complete. Press any key to return to the dashboard.";
  let successful = true;
  try {
    await operation(screen.append);
    screen.append(`\n✓ ${message}\n`);
  } catch (error) {
    successful = false;
    message = "Operation failed. Press any key to return to the dashboard.";
    screen.append(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  }
  screen.finish(message, successful);
  await new Promise<void>((resolve) => renderer.keyInput.once("keypress", () => resolve()));
  renderer.destroy();
}

async function showQualityReport(root: string): Promise<void> {
  const report = await loadQualityReport(root);
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  buildQualityReportScreen(renderer, report);
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
  const dashboard = buildDashboard(renderer, state, actions.map((action, index) => ({
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
    dashboard.select.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option: SelectOption) => finish(actions[Number(option.value)]));
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) finish();
      else if (key.name === "[" || key.name === "left") dashboard.cycleDocument(-1);
      else if (key.name === "]" || key.name === "right" || key.name === "tab") dashboard.cycleDocument(1);
    });
  });
}

export async function openDashboard(root = process.cwd()): Promise<void> {
  let running = true;
  while (running) {
    const state = await loadDashboardState(root);
    const actions: Action[] = state.initialized ? [
      { label: "Refresh with AI", description: "Use the configured provider/model and optionally add project context.", prepare: async () => {
        const details = await collectProjectDetails("Refresh details · optional");
        return details === null ? undefined : async (onOutput) => runDashboardCommand(root, refreshCommand, { deterministic: false, details }, onOutput);
      } },
      { label: "Refresh deterministically", description: "Run without model inference; optionally record project context.", prepare: async () => {
        const details = await collectProjectDetails("Refresh details · optional");
        return details === null ? undefined : async (onOutput) => runDashboardCommand(root, refreshCommand, { deterministic: true, details }, onOutput);
      } },
      { label: "Change provider / model", description: "Select inference settings, then regenerate the harness.", prepare: async () => {
        const choice = await chooseInference();
        if (!choice) return undefined;
        return async (onOutput) => {
          await configureInference(root, choice);
          await runDashboardCommand(root, refreshCommand, { deterministic: choice.deterministic }, onOutput);
        };
      } },
      { label: "Quality report", description: "Open an actionable health view with score, gaps, and next steps.", prepare: async () => {
        await showQualityReport(root);
        return undefined;
      } },
      { label: "Manage critical gates", description: "Select, activate, remove, or add protected paths in one interactive screen.", prepare: async () => {
        const plan = await manageGates(root);
        if (!plan || (!plan.activate.length && !plan.remove.length && !plan.add)) return undefined;
        return async (onOutput) => {
          for (const glob of plan.activate) await runDashboardCommand(root, activateCriticalCommand, { glob }, onOutput);
          for (const glob of plan.remove) await runDashboardCommand(root, removeCriticalCommand, { glob }, onOutput);
          if (plan.add) await runDashboardCommand(root, addCriticalCommand, plan.add, onOutput);
        };
      } },
      { label: "Sync integrations", description: "Regenerate provider files from stored facts.", prepare: async () => async (onOutput) => runDashboardCommand(root, syncCommand, {}, onOutput) },
      { label: "Delete harness state", description: "Remove .harnessme after confirmation.", prepare: async () => {
        if (!await confirmRemoval()) return undefined;
        return async () => removeHarnessState(root);
      } },
      { label: "Exit", description: "Close the dashboard.", prepare: async () => { running = false; return undefined; } },
    ] : [
      { label: "Initialize", description: "Analyze this repository and create its harness.", prepare: async () => {
        const choice = await chooseInitSettings();
        if (!choice) return undefined;
        return async (onOutput) => runDashboardCommand(root, initCommand, {
          provider: choice.provider ?? "auto",
          deterministic: choice.deterministic,
          model: choice.model,
          thinkingLevel: choice.reasoningEffort,
          councilSize: choice.councilSize,
          aiApiKeyEnv: "",
          aiInclude: "**/*",
          reviewAiApiKeyEnv: "",
          criticalApprovers: "developer",
          details: choice.details,
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
