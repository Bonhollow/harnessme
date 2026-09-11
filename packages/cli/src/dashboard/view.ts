import {
  BoxRenderable,
  SelectRenderable,
  type CliRenderer,
  type SelectOption,
} from "@opentui/core";
import type { DashboardState } from "./state.js";
import type { QualityReport } from "./quality.js";
import { addText, COLORS } from "./theme.js";

function trendLabel(delta: number): string {
  if (delta > 0) return `↑ +${delta}`;
  if (delta < 0) return `↓ ${delta}`;
  return "→ 0";
}

function scoreSparkline(scores: number[]): string {
  const bars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  return scores.map((score) => bars[Math.min(bars.length - 1, Math.floor((score / 101) * bars.length))]).join("");
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
  const sidebar = new BoxRenderable(renderer, { width: 40, flexDirection: "column", border: true, borderColor: COLORS.border, title: " Harness control " });
  body.add(sidebar);
  const health = [
    `${state.initialized ? "●" : "○"} ${state.initialized ? "Harness installed" : "Harness not initialized"}`,
    `Gates ${state.activeGates}/${state.proposedGates} active/proposed  ·  ${state.references} guides  ·  ${state.graphNodes} graph nodes`,
  ].join("\n");
  const inference = [
    `${state.mode}  ·  ${state.provider}`,
    `${state.model}  ·  thinking ${state.thinking}`,
  ].join("\n");
  const healthCard = new BoxRenderable(renderer, { border: true, borderColor: state.initialized ? COLORS.success : COLORS.border, title: " Health ", paddingX: 1, height: 4 });
  sidebar.add(healthCard);
  addText(renderer, healthCard, health, { height: 2, fg: state.initialized ? COLORS.success : COLORS.muted, truncate: true });
  if (state.quality) {
    const score = state.quality.score;
    const scoreColor = score >= 90 ? COLORS.success : score >= 55 ? COLORS.warning : COLORS.danger;
    const filled = Math.round((score / 100) * 18);
    const qualityCard = new BoxRenderable(renderer, { border: true, borderColor: scoreColor, title: ` Quality · ${state.quality.grade} `, paddingX: 1, height: 6, flexDirection: "column" });
    sidebar.add(qualityCard);
    const trend = state.qualityTrend ? `  ·  ${trendLabel(state.qualityTrend.delta)}` : "";
    addText(renderer, qualityCard, `${score}/100  ·  confidence ${state.quality.confidence}%${trend}`, { height: 1, fg: scoreColor });
    addText(renderer, qualityCard, `${"█".repeat(filled)}${"░".repeat(18 - filled)}`, { height: 1, fg: scoreColor });
    const weakest = [...state.quality.dimensions].sort((left, right) => left.score - right.score).slice(0, 2);
    for (const dimension of weakest) {
      const bars = Math.round((dimension.score / 100) * 8);
      const color = dimension.score >= 80 ? COLORS.success : dimension.score >= 55 ? COLORS.warning : COLORS.danger;
      addText(renderer, qualityCard, `${dimension.label.padEnd(13)} ${String(dimension.score).padStart(3)}% ${"▰".repeat(bars)}${"▱".repeat(8 - bars)}`, { height: 1, fg: color, truncate: true });
    }
  }
  const inferenceCard = new BoxRenderable(renderer, { border: true, borderColor: COLORS.border, title: " Inference ", paddingX: 1, height: 4 });
  sidebar.add(inferenceCard);
  addText(renderer, inferenceCard, inference, { height: 2, fg: COLORS.text, truncate: true });
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
  const scoreColor = score >= 90 ? COLORS.success : score >= 55 ? COLORS.warning : COLORS.danger;
  const filled = Math.round((score / 100) * 28);
  const header = new BoxRenderable(renderer, { height: 5, backgroundColor: COLORS.blue, paddingX: 2, flexDirection: "column" });
  root.add(header);
  addText(renderer, header, "HarnessME  ·  Quality intelligence", { height: 1, fg: "#bae6fd" });
  const trend = report.trend ? `  ·  ${trendLabel(report.trend.delta)} since previous` : "";
  addText(renderer, header, `${score}/100  ${report.quality.grade.toUpperCase()}  ·  assessment confidence ${report.quality.confidence}%${trend}`, { height: 1, fg: scoreColor });
  addText(renderer, header, `${"█".repeat(filled)}${"░".repeat(28 - filled)}  ${report.quality.checks.filter((check) => check.passed).length}/${report.quality.checks.length} checks at target`, { height: 1, fg: "#e0f2fe" });
  const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "row", gap: 1 });
  root.add(body);
  const dimensions = new BoxRenderable(renderer, { width: "30%", border: true, borderColor: COLORS.border, title: " Dimension profile ", padding: 1, flexDirection: "column" });
  body.add(dimensions);
  for (const dimension of report.quality.dimensions) {
    const width = 16;
    const bars = Math.round((dimension.score / 100) * width);
    const color = dimension.score >= 80 ? COLORS.success : dimension.score >= 55 ? COLORS.warning : COLORS.danger;
    addText(renderer, dimensions, `${dimension.label.padEnd(14)} ${String(dimension.score).padStart(3)}%`, { height: 1, fg: color });
    addText(renderer, dimensions, `${"█".repeat(bars)}${"░".repeat(width - bars)}  ${dimension.summary}`, { height: 1, fg: color, truncate: true });
  }
  const coverage = new BoxRenderable(renderer, { width: "31%", border: true, borderColor: COLORS.border, title: " Coverage and depth ", padding: 1, flexDirection: "column" });
  body.add(coverage);
  for (const metric of report.quality.metrics) {
    const width = 12;
    const bars = Math.round((metric.percentage / 100) * width);
    const color = metric.percentage >= 80 ? COLORS.success : metric.percentage >= 50 ? COLORS.warning : COLORS.danger;
    addText(renderer, coverage, `${metric.label}  ${metric.value}/${metric.target}`, { height: 1, fg: color, truncate: true });
    addText(renderer, coverage, `${"▓".repeat(bars)}${"░".repeat(width - bars)} ${metric.percentage}%  ${metric.detail}`, { height: 1, fg: color, truncate: true });
  }
  if (report.trend) {
    addText(renderer, coverage, `History  ${report.trend.snapshots} assessments · range ${report.trend.lowestScore}-${report.trend.bestScore}`, { height: 1, fg: COLORS.accent, truncate: true });
    addText(renderer, coverage, `${scoreSparkline(report.trend.series)}  ${report.trend.series.join(" → ")}`, { height: 1, fg: report.trend.delta < 0 ? COLORS.danger : COLORS.success, truncate: true });
  }
  const findings = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderColor: COLORS.border, title: " Priority findings ", padding: 1, flexDirection: "column" });
  body.add(findings);
  const priority = report.quality.findings.slice(0, 5);
  if (!priority.length) addText(renderer, findings, "No material gaps detected. Reassess after structural changes.", { fg: COLORS.success, wrapMode: "word" });
  for (const finding of priority) {
    const color = finding.severity === "high" || finding.severity === "critical" ? COLORS.danger : finding.severity === "medium" ? COLORS.warning : COLORS.text;
    addText(renderer, findings, `${finding.severity.toUpperCase()} · ${finding.dimension}`, { height: 1, fg: color });
    addText(renderer, findings, finding.message, { height: 1, fg: COLORS.text, truncate: true });
    addText(renderer, findings, `→ ${finding.action}`, { height: 2, fg: color, wrapMode: "word" });
  }
  addText(renderer, findings, `Generation: ${report.generation}\n${report.references} guides · ${report.activeGates} active gates · ${report.conflicts} conflicts`, { fg: COLORS.muted, wrapMode: "word" });
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
