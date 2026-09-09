import {
  BoxRenderable,
  SelectRenderable,
  TextRenderable,
  type CliRenderer,
  type SelectOption,
} from "@opentui/core";
import type { DashboardState } from "./state.js";

const COLORS = {
  background: "#0b1020",
  panel: "#121a2e",
  border: "#334155",
  accent: "#22d3ee",
  selected: "#164e63",
  text: "#e2e8f0",
  muted: "#94a3b8",
  success: "#4ade80",
};

function addText(renderer: CliRenderer, parent: BoxRenderable, content: string, options: ConstructorParameters<typeof TextRenderable>[1] = {}): TextRenderable {
  const text = new TextRenderable(renderer, { content, fg: COLORS.text, wrapMode: "word", ...options });
  parent.add(text);
  return text;
}

export function buildSelectionScreen(
  renderer: CliRenderer,
  title: string,
  description: string,
  options: SelectOption[],
): SelectRenderable {
  const root = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background, padding: 1, gap: 1 });
  renderer.root.add(root);
  const header = new BoxRenderable(renderer, { height: 4, backgroundColor: "#075985", paddingX: 2, flexDirection: "column" });
  root.add(header);
  addText(renderer, header, "HarnessME  ·  Guided configuration", { height: 1, fg: "#bae6fd" });
  addText(renderer, header, title, { height: 1, fg: "#ffffff" });
  addText(renderer, header, description, { height: 1, fg: "#e0f2fe", truncate: true });
  const panel = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderColor: COLORS.border, title: " Choose an option ", padding: 1, flexDirection: "column" });
  root.add(panel);
  const select = new SelectRenderable(renderer, {
    options,
    flexGrow: 1,
    focusedBackgroundColor: COLORS.panel,
    selectedBackgroundColor: COLORS.selected,
    selectedTextColor: "#ffffff",
    textColor: COLORS.text,
    descriptionColor: COLORS.muted,
    wrapSelection: true,
    showDescription: true,
  });
  panel.add(select);
  addText(renderer, root, ` ${options.length} option${options.length === 1 ? "" : "s"} available   ·   ↑/↓ navigate   Enter select   Esc/q back`, { height: 1, fg: COLORS.muted });
  select.focus();
  return select;
}

export function buildDashboard(renderer: CliRenderer, state: DashboardState, options: SelectOption[]): SelectRenderable {
  const root = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background });
  renderer.root.add(root);
  const header = new BoxRenderable(renderer, { height: 3, backgroundColor: "#075985", paddingX: 2, flexDirection: "column" });
  root.add(header);
  addText(renderer, header, "HarnessME  Repository Agent Control Center", { height: 1, fg: "#ffffff" });
  addText(renderer, header, state.repository, { height: 1, fg: "#bae6fd", truncate: true });

  const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "row", gap: 1, padding: 1 });
  root.add(body);
  const sidebar = new BoxRenderable(renderer, { width: 34, flexDirection: "column", gap: 1, border: true, borderColor: COLORS.border, title: " Harness " });
  body.add(sidebar);
  const status = [
    `${state.initialized ? "✓" : "✗"} ${state.initialized ? "Installed" : "Not initialized"}`,
    `Quality   ${state.quality}`,
    `Mode      ${state.mode}`,
    `Provider  ${state.provider}`,
    `Model     ${state.model}`,
    `Thinking  ${state.thinking}`,
    `Gates     ${state.activeGates} active · ${state.proposedGates} proposed`,
    `Guides    ${state.references}`,
  ].join("\n");
  addText(renderer, sidebar, status, { height: 8, fg: state.initialized ? COLORS.success : COLORS.muted, truncate: true });
  const select = new SelectRenderable(renderer, {
    options,
    flexGrow: 1,
    focusedBackgroundColor: COLORS.panel,
    selectedBackgroundColor: COLORS.selected,
    selectedTextColor: "#ffffff",
    textColor: COLORS.text,
    descriptionColor: COLORS.muted,
    wrapSelection: true,
    showDescription: false,
  });
  sidebar.add(select);

  const preview = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderColor: COLORS.border, title: " Current AGENTS.md ", padding: 1, overflow: "hidden" });
  body.add(preview);
  addText(renderer, preview, state.preview.join("\n"), { width: "100%", height: "100%", fg: COLORS.text });
  const footer = new BoxRenderable(renderer, { height: 1, paddingX: 2 });
  root.add(footer);
  addText(renderer, footer, "↑/↓ navigate  Enter select  Esc/q exit", { height: 1, fg: COLORS.muted });
  select.focus();
  return select;
}

export interface OperationScreen {
  append: (chunk: string) => void;
  finish: (message: string, successful?: boolean) => void;
}

export function buildOperationScreen(renderer: CliRenderer, title: string): OperationScreen {
  const root = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background, padding: 1, gap: 1 });
  renderer.root.add(root);
  const header = new BoxRenderable(renderer, { height: 4, backgroundColor: "#075985", paddingX: 2, flexDirection: "column" });
  root.add(header);
  addText(renderer, header, "HarnessME  ·  Operation in progress", { height: 1, fg: "#bae6fd" });
  addText(renderer, header, title, { height: 1, fg: "#ffffff" });
  const progress = addText(renderer, header, "○ Preparing operation…", { height: 1, fg: "#e0f2fe" });
  const outputBox = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderColor: COLORS.border, title: " Operation output ", padding: 1, overflow: "hidden" });
  root.add(outputBox);
  const output = addText(renderer, outputBox, "Starting…", { width: "100%", height: "100%", fg: COLORS.text, wrapMode: "char" });
  const footer = addText(renderer, root, "Please wait…", { height: 1, fg: COLORS.muted });
  const lines: string[] = [];
  const append = (chunk: string): void => {
    const nextLines = chunk.replace(/\r/g, "").split("\n");
    lines.push(...nextLines);
    for (const line of nextLines) {
      const match = line.match(/[✓…]\s*\[(\d+)\/(\d+)\]\s*(.+)/u);
      if (!match?.[1] || !match[2]) continue;
      const current = Number(match[1]);
      const total = Number(match[2]);
      const filled = Math.max(1, Math.min(18, Math.round((current / total) * 18)));
      progress.content = `${"●".repeat(filled)}${"○".repeat(18 - filled)}  ${current}/${total}  ${match[3]}`;
    }
    if (lines.length > 180) lines.splice(0, lines.length - 180);
    output.content = lines.join("\n").trim() || "Starting…";
    footer.content = "Operation running…";
  };
  return {
    append,
    finish(message: string, successful = true): void {
      footer.content = message;
      progress.content = successful
        ? "●".repeat(18) + "  Complete"
        : "✗  Operation failed — review the output above";
    },
  };
}
