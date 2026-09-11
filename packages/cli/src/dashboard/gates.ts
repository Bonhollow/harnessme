import {
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  BoxRenderable,
  createCliRenderer,
  type SelectOption,
} from "@opentui/core";
import { readFacts, type CriticalPath } from "@harnessme/core";
import { buildGatePlan, type GatePlan } from "./gate-plan.js";
import { addText, COLORS } from "./theme.js";

async function textEntry(title: string, description: string, placeholder: string): Promise<string | undefined> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const root = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background, padding: 2, gap: 1 });
  renderer.root.add(root);
  addText(renderer, root, title, { height: 1, fg: COLORS.accent });
  addText(renderer, root, description, { height: 2, fg: COLORS.muted });
  const input = new InputRenderable(renderer, {
    width: "100%",
    placeholder,
    textColor: COLORS.text,
    focusedBackgroundColor: COLORS.panel,
    backgroundColor: COLORS.panel,
  });
  root.add(input);
  addText(renderer, root, "Enter continue  Esc/q cancel", { height: 1, fg: COLORS.muted });
  input.focus();
  return new Promise((resolve) => {
    let done = false;
    const finish = (value?: string): void => {
      if (done) return;
      done = true;
      renderer.destroy();
      resolve(value?.trim() || undefined);
    };
    input.on(InputRenderableEvents.ENTER, () => finish(input.value));
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) finish();
    });
  });
}

async function customGate(): Promise<GatePlan["add"] | undefined> {
  const glob = await textEntry("Add critical gate · 1/3", "Enter a repository-relative file path or glob. Example: src/payments/**", "src/core/**");
  if (!glob) return undefined;
  const reason = await textEntry("Add critical gate · 2/3", "Explain why edits to this path require explicit developer confirmation.", "Public contract used by multiple consumers");
  if (!reason) return undefined;
  const approvers = await textEntry("Add critical gate · 3/3", "Enter one or more GitHub handles, separated by commas.", "developer");
  return approvers ? { glob, reason, approvers } : undefined;
}

function gateOption(gate: CriticalPath, selected: boolean): SelectOption {
  const intent = gate.status === "proposed" ? "activate" : "remove";
  return {
    name: `${selected ? "☑" : "☐"} ${gate.glob}`,
    description: `${gate.status} · ${gate.risk ?? "other"} · ${selected ? `will ${intent}` : gate.reason}`,
    value: gate.glob,
  };
}

export async function manageGates(root: string): Promise<GatePlan | undefined> {
  const facts = await readFacts(root);
  const gates = facts.criticalPaths.paths.slice().sort((left, right) => left.status.localeCompare(right.status) || left.glob.localeCompare(right.glob));
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const selected = new Set<string>();
  const rootBox = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background });
  renderer.root.add(rootBox);
  const header = new BoxRenderable(renderer, { height: 3, backgroundColor: "#075985", paddingX: 2, flexDirection: "column" });
  rootBox.add(header);
  addText(renderer, header, "HarnessME  Critical Gate Manager", { height: 1, fg: "#ffffff" });
  addText(renderer, header, "Select several paths, then apply the protection changes together.", { height: 1, fg: "#bae6fd" });
  const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "row", gap: 1, padding: 1 });
  rootBox.add(body);
  const listBox = new BoxRenderable(renderer, { width: "58%", border: true, borderColor: COLORS.border, title: " Gates ", padding: 1 });
  body.add(listBox);
  const details = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "column", border: true, borderColor: COLORS.border, title: " Selection ", padding: 1, gap: 1 });
  body.add(details);
  const summary = addText(renderer, details, "No gates selected.", { fg: COLORS.muted });
  const selectedDetails = addText(renderer, details, "Choose a path with Enter or Space.", { fg: COLORS.text, wrapMode: "word" });
  const options = (): SelectOption[] => gates.map((gate) => gateOption(gate, selected.has(gate.glob)));
  const select = new SelectRenderable(renderer, {
    options: options(), flexGrow: 1, focusedBackgroundColor: COLORS.panel, selectedBackgroundColor: COLORS.selected,
    selectedTextColor: "#ffffff", textColor: COLORS.text, descriptionColor: COLORS.muted, wrapSelection: true, showDescription: true,
  });
  listBox.add(select);
  const footer = new BoxRenderable(renderer, { height: 1, paddingX: 2 });
  rootBox.add(footer);
  addText(renderer, footer, "↑/↓ navigate  Enter/Space toggle  a all/none  s apply  n add gate  Esc/q back", { height: 1, fg: COLORS.muted });
  select.focus();

  const refresh = (): void => {
    select.options = options();
    const active = gates.filter((gate) => gate.status === "active" && selected.has(gate.glob)).length;
    const proposed = gates.filter((gate) => gate.status === "proposed" && selected.has(gate.glob)).length;
    summary.content = selected.size ? `${proposed} proposed gate(s) will activate\n${active} active gate(s) will be removed` : "No gates selected. Add a custom gate or select existing paths.";
    const current = select.getSelectedOption();
    const gate = gates.find((item) => item.glob === current?.value);
    selectedDetails.content = gate
      ? `${gate.status === "active" ? "ACTIVE — protected before edits" : "PROPOSED — advisory until activated"}\n\nRisk: ${gate.risk ?? "other"}\n\n${gate.reason}\n\nApprovers: ${gate.approvers.map((item) => `@${item}`).join(", ")}`
      : "No recognized critical paths yet. Press n to add one.";
    renderer.requestRender();
  };
  const toggleCurrent = (): void => {
    const current = select.getSelectedOption()?.value;
    if (typeof current !== "string") return;
    if (selected.has(current)) selected.delete(current);
    else selected.add(current);
    refresh();
  };
  refresh();
  return new Promise((resolve) => {
    let done = false;
    const finish = async (kind: "cancel" | "apply" | "add"): Promise<void> => {
      if (done) return;
      done = true;
      renderer.destroy();
      if (kind === "cancel") return resolve(undefined);
      if (kind === "add") return resolve({ activate: [], remove: [], add: await customGate() });
      resolve(buildGatePlan(gates, selected));
    };
    select.on(SelectRenderableEvents.ITEM_SELECTED, () => toggleCurrent());
    select.on(SelectRenderableEvents.SELECTION_CHANGED, () => refresh());
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) void finish("cancel");
      else if (key.name === "space") toggleCurrent();
      else if (key.name === "a") {
        if (selected.size === gates.length) selected.clear();
        else gates.forEach((gate) => selected.add(gate.glob));
        refresh();
      } else if (key.name === "s") void finish("apply");
      else if (key.name === "n") void finish("add");
    });
  });
}
