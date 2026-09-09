import {
  BoxRenderable,
  SelectRenderable,
  TextRenderable,
  type CliRenderer,
  type SelectOption,
} from "@opentui/core";
import type { DashboardState } from "./state.js";
import type { QualityReport } from "./quality.js";

const COLORS = {
  background: "#0b1020",
  panel: "#121a2e",
  border: "#334155",
  accent: "#22d3ee",
  selected: "#164e63",
  text: "#e2e8f0",
  muted: "#94a3b8",
  success: "#4ade80",
  warning: "#fbbf24",
  danger: "#fb7185",
  blue: "#075985",
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

export interface DashboardView {
  select: SelectRenderable;
  cycleDocument: (direction: 1 | -1) => void;
}

export function buildDashboard(renderer: CliRenderer, state: DashboardState, options: SelectOption[]): DashboardView {
  const root = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background });
  renderer.root.add(root);
  const header = new BoxRenderable(renderer, { height: 4, backgroundColor: COLORS.blue, paddingX: 2, flexDirection: "column" });
  root.add(header);
  addText(renderer, header, "HarnessME  Repository Agent Control Center", { height: 1, fg: "#ffffff" });
  addText(renderer, header, state.repository, { height: 1, fg: "#bae6fd", truncate: true });
  addText(renderer, header, state.initialized ? "Governance, safety gates, and harness health in one place" : "Initialize a governed operating contract for this repository", { height: 1, fg: "#e0f2fe", truncate: true });

  const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "row", gap: 1, padding: 1 });
  root.add(body);
  const sidebar = new BoxRenderable(renderer, { width: 40, flexDirection: "column", gap: 1, border: true, borderColor: COLORS.border, title: " Harness control " });
  body.add(sidebar);
  const health = [
    `${state.initialized ? "●" : "○"} ${state.initialized ? "Harness installed" : "Harness not initialized"}`,
    `Quality   ${state.quality}`,
    `Gates     ${state.activeGates} active · ${state.proposedGates} proposed`,
    `Guides    ${state.references} scoped guide${state.references === 1 ? "" : "s"}`,
  ].join("\n");
  const inference = [
    `Mode      ${state.mode}`,
    `Provider  ${state.provider}`,
    `Model     ${state.model}`,
    `Thinking  ${state.thinking}`,
  ].join("\n");
  const healthCard = new BoxRenderable(renderer, { border: true, borderColor: state.initialized ? COLORS.success : COLORS.border, title: " Health ", paddingX: 1, height: 6 });
  sidebar.add(healthCard);
  addText(renderer, healthCard, health, { height: 4, fg: state.initialized ? COLORS.success : COLORS.muted, truncate: true });
  const inferenceCard = new BoxRenderable(renderer, { border: true, borderColor: COLORS.border, title: " Inference ", paddingX: 1, height: 6 });
  sidebar.add(inferenceCard);
  addText(renderer, inferenceCard, inference, { height: 4, fg: COLORS.text, truncate: true });
  addText(renderer, sidebar, " Actions ", { height: 1, fg: COLORS.accent });
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
  sidebar.add(select);

  const preview = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderColor: COLORS.border, title: " Generated harness documents ", padding: 1, flexDirection: "column", overflow: "hidden" });
  body.add(preview);
  const tabs = addText(renderer, preview, "", { height: 1, fg: COLORS.accent, truncate: true });
  const documentPath = addText(renderer, preview, "", { height: 1, fg: COLORS.muted, truncate: true });
  const documentPreview = addText(renderer, preview, "", { width: "100%", flexGrow: 1, fg: COLORS.text, wrapMode: "word" });
  let documentIndex = 0;
  const renderDocument = (): void => {
    const document = state.documents[documentIndex];
    if (!document) return;
    const previous = state.documents[(documentIndex - 1 + state.documents.length) % state.documents.length];
    const next = state.documents[(documentIndex + 1) % state.documents.length];
    tabs.content = `Document ${documentIndex + 1}/${state.documents.length}   ‹ ${previous?.label ?? ""}   [${document.label}]   ${next?.label ?? ""} ›`;
    documentPath.content = document.path || "Select Initialize to create the generated document set.";
    documentPreview.content = document.content.join("\n");
    renderer.requestRender();
  };
  renderDocument();
  const footer = new BoxRenderable(renderer, { height: 1, paddingX: 2 });
  root.add(footer);
  addText(renderer, footer, "↑/↓ navigate   Enter select   [/]/Tab switch documents   Esc/q exit", { height: 1, fg: COLORS.muted, truncate: true });
  select.focus();
  return {
    select,
    cycleDocument(direction: 1 | -1): void {
      documentIndex = (documentIndex + direction + state.documents.length) % state.documents.length;
      renderDocument();
    },
  };
}

export function buildQualityReportScreen(renderer: CliRenderer, report: QualityReport): void {
  const root = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background, padding: 1, gap: 1 });
  renderer.root.add(root);
  const score = report.quality.score;
  const healthy = score >= 90;
  const scoreColor = score >= 90 ? COLORS.success : score >= 70 ? COLORS.warning : COLORS.danger;
  const filled = Math.round((score / 100) * 24);
  const header = new BoxRenderable(renderer, { height: 5, backgroundColor: COLORS.blue, paddingX: 2, flexDirection: "column" });
  root.add(header);
  addText(renderer, header, "HarnessME  ·  Quality intelligence", { height: 1, fg: "#bae6fd" });
  addText(renderer, header, `${score}/100  ${healthy ? "Ready to work" : "Needs attention"}`, { height: 1, fg: scoreColor });
  addText(renderer, header, `${"●".repeat(filled)}${"○".repeat(24 - filled)}  ${report.quality.checks.filter((check) => check.passed).length}/${report.quality.checks.length} dimensions healthy`, { height: 1, fg: "#e0f2fe" });
  const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "row", gap: 1 });
  root.add(body);
  const checks = new BoxRenderable(renderer, { width: "62%", border: true, borderColor: COLORS.border, title: " Quality dimensions ", padding: 1, flexDirection: "column" });
  body.add(checks);
  for (const check of report.quality.checks) {
    const icon = check.passed ? "✓" : "✗";
    const color = check.passed ? COLORS.success : COLORS.danger;
    addText(renderer, checks, `${icon}  ${String(check.points).padStart(2, " ")} pts  ${check.message}`, { height: 1, fg: color, truncate: true });
  }
  const context = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderColor: COLORS.border, title: " Readiness context ", padding: 1, flexDirection: "column" });
  body.add(context);
  const failed = report.quality.checks.filter((check) => !check.passed);
  const next = failed.length
    ? `Next best action\n${failed.map((check) => `• ${check.message}`).join("\n")}`
    : "Next best action\n• The harness is ready. Use refresh after material architecture or contract changes.";
  addText(renderer, context, next, { fg: failed.length ? COLORS.warning : COLORS.success, wrapMode: "word" });
  addText(renderer, context, `\nGeneration\n${report.generation}\n\nCoverage\n${report.references} guides · ${report.activeGates} active gates\n${report.conflicts ? `${report.conflicts} documentation conflict${report.conflicts === 1 ? "" : "s"}` : "No documentation conflicts"}`, { fg: COLORS.text, wrapMode: "word" });
  addText(renderer, root, "Press any key to return to the dashboard", { height: 1, fg: COLORS.muted });
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
