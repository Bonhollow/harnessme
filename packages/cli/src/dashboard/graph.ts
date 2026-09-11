import { BoxRenderable, CliRenderEvents, SelectRenderable, SelectRenderableEvents, createCliRenderer, type SelectOption } from "@opentui/core";
import { readFacts } from "@harnessme/core";
import { createGraphScene } from "./graph-scene.js";
import { addText, COLORS } from "./theme.js";

export async function exploreGraph(root: string): Promise<"back" | "manage"> {
  const graph = (await readFacts(root)).knowledgeGraph;
  if (!graph) throw new Error("No knowledge graph exists. Run `harnessme refresh` or `harnessme sync` first.");
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const rootBox = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background });
  renderer.root.add(rootBox);
  const header = new BoxRenderable(renderer, { height: 3, backgroundColor: "#075985", paddingX: 2, flexDirection: "column" });
  rootBox.add(header);
  addText(renderer, header, "HarnessME  Knowledge Graph", { height: 1, fg: "#ffffff" });
  addText(renderer, header, `${graph.nodes.length} nodes · ${graph.edges.length} edges · ${graph.generation}`, { height: 1, fg: "#bae6fd" });
  const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: "row", gap: 1, padding: 1 });
  rootBox.add(body);
  const index = new BoxRenderable(renderer, { width: 38, border: true, borderColor: COLORS.border, title: " Nodes ", padding: 1 });
  const canvas = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderColor: COLORS.accent, title: " Stable focus map ", padding: 1, flexDirection: "column" });
  const details = new BoxRenderable(renderer, { width: 42, border: true, borderColor: COLORS.border, title: " Evidence and support ", padding: 1 });
  body.add(index); body.add(canvas); body.add(details);
  const layout = (): void => {
    const narrow = renderer.terminalWidth < 110;
    body.flexDirection = narrow ? "column" : "row";
    index.width = narrow ? "100%" : 38; index.height = narrow ? 8 : "auto";
    details.width = narrow ? "100%" : 42; details.height = narrow ? 9 : "auto";
  };
  layout();
  const ordered = [...graph.nodes].sort((a, b) => (["feature", "concern", "module"].includes(a.kind) ? 0 : 1) - (["feature", "concern", "module"].includes(b.kind) ? 0 : 1) || a.label.localeCompare(b.label));
  let visible = ordered;
  const nodeOptions = (): SelectOption[] => visible.map((node) => ({ name: node.label, description: node.kind, value: node.id }));
  const options: SelectOption[] = nodeOptions();
  const select = new SelectRenderable(renderer, { options, flexGrow: 1, focusedBackgroundColor: COLORS.panel, selectedBackgroundColor: COLORS.selected, selectedTextColor: "#ffffff", textColor: COLORS.text, descriptionColor: COLORS.muted, wrapSelection: true, showDescription: true, showScrollIndicator: true });
  index.add(select);
  const mapText = addText(renderer, canvas, "", { width: "100%", flexGrow: 1, fg: COLORS.accent, wrapMode: "word" });
  const detailText = addText(renderer, details, "", { width: "100%", flexGrow: 1, wrapMode: "word" });
  let radius = 1;
  let reverse = false;
  let filter: "all" | "semantic" | "structure" = "all";
  let searching = false;
  let query = "";
  let citationIndex = 0;
  const history: string[] = [];
  const render = (): void => {
    const selected = graph.nodes.find((node) => node.id === select.getSelectedOption()?.value) ?? ordered[0];
    if (!selected) return;
    mapText.content = createGraphScene(graph, selected, radius, reverse, Math.max(40, renderer.terminalWidth < 110 ? renderer.terminalWidth - 6 : renderer.terminalWidth - 86));
    const citations = selected.citations.length
      ? selected.citations.map((citation, index) => `${index === citationIndex % selected.citations.length ? "▶" : " "} ${citation.path}:${citation.line}`).join("\n")
      : "No direct citation";
    detailText.content = `${selected.label}\n${selected.id}\n\n${selected.summary ?? selected.path ?? selected.scope ?? ""}\n\nProvenance\n${selected.provenance}\n\nEvidence\n${citations}\n\nGuide\n${selected.guide ?? "—"}`;
    renderer.requestRender();
  };
  select.on(SelectRenderableEvents.SELECTION_CHANGED, render);
  renderer.on(CliRenderEvents.RESIZE, () => { layout(); render(); });
  render(); select.focus();
  const footer = new BoxRenderable(renderer, { height: 1, paddingX: 2 }); rootBox.add(footer);
  const help = addText(renderer, footer, "↑/↓ node  ←/→ follow  Backspace history  e evidence  m manage  +/- radius  / search  f filter  i reverse  Esc/q back", { height: 1, fg: COLORS.muted });
  const result = await new Promise<"back" | "manage">((resolve) => renderer.keyInput.on("keypress", (key) => {
    if (searching) {
      key.preventDefault();
      if (key.name === "escape") { searching = false; query = ""; }
      else if (key.name === "return" || key.name === "enter") searching = false;
      else if (key.name === "backspace") query = query.slice(0, -1);
      else if (key.sequence.length === 1 && !key.ctrl && !key.meta) query += key.sequence;
      visible = ordered.filter((node) => `${node.label} ${node.id} ${node.path ?? ""}`.toLowerCase().includes(query.toLowerCase()));
      select.options = nodeOptions();
      help.content = searching ? `Search: ${query || "_"}   Enter accept   Esc clear` : "↑/↓ node   ←/→ relationship   +/- radius   / search   f filter   i reverse   Esc/q back";
      render();
    } else if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) resolve("back");
    else if (key.name === "m") resolve("manage");
    else if (key.name === "e") { citationIndex += 1; render(); }
    else if (key.name === "backspace") {
      const previous = history.pop();
      const index = visible.findIndex((node) => node.id === previous);
      if (index >= 0) select.setSelectedIndex(index);
    }
    else if (key.name === "+" || key.name === "=") { radius = Math.min(3, radius + 1); render(); }
    else if (key.name === "-") { radius = Math.max(1, radius - 1); render(); }
    else if (key.name === "i") { reverse = !reverse; render(); }
    else if (key.name === "/") { key.preventDefault(); searching = true; query = ""; help.content = "Search: _   Enter accept   Esc clear"; renderer.requestRender(); }
    else if (key.name === "f") {
      filter = filter === "all" ? "semantic" : filter === "semantic" ? "structure" : "all";
      visible = ordered.filter((node) => filter === "all" || (filter === "semantic" ? ["feature", "concern"].includes(node.kind) : !["feature", "concern"].includes(node.kind)));
      select.options = nodeOptions(); help.content = `Filter: ${filter}   ↑/↓ node   / search   f cycle   i reverse   Esc/q back`; render();
    } else if (key.name === "left" || key.name === "right") {
      key.preventDefault();
      const selectedId = select.getSelectedOption()?.value;
      const candidates = graph.edges.filter((edge) => key.name === "left" ? edge.to === selectedId : edge.from === selectedId).map((edge) => key.name === "left" ? edge.from : edge.to);
      const index = visible.findIndex((node) => node.id === candidates[0]);
      if (index >= 0) { if (typeof selectedId === "string") history.push(selectedId); citationIndex = 0; select.setSelectedIndex(index); }
    }
  }));
  renderer.destroy();
  return result;
}
