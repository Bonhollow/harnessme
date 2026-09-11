import { BoxRenderable, InputRenderable, InputRenderableEvents, SelectRenderable, SelectRenderableEvents, createCliRenderer } from "@opentui/core";
import { readFacts } from "@harnessme/core";
import { addText, COLORS } from "./theme.js";
export type FeaturePlan = { kind: "add"; slug: string; title: string; summary: string; scopes: string; responsibilities?: string; invariants?: string; validation?: string }
  | { kind: "edit"; slug: string; title?: string; summary?: string; scopes?: string; responsibilities?: string; invariants?: string; validation?: string }
  | { kind: "remove"; slug: string }
  | { kind: "link" | "unlink"; from: string; to: string; relationshipKind: "depends-on" | "related-to" };

async function input(title: string, placeholder: string, initial = ""): Promise<string | undefined> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const root = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background, padding: 2, gap: 1 }); renderer.root.add(root);
  addText(renderer, root, title, { height: 1, fg: COLORS.accent });
  const field = new InputRenderable(renderer, { width: "100%", value: initial, placeholder, backgroundColor: COLORS.panel, focusedBackgroundColor: COLORS.panel, textColor: COLORS.text }); root.add(field);
  addText(renderer, root, "Enter continue   Esc cancel", { height: 1, fg: COLORS.muted }); field.focus();
  return new Promise((resolve) => { let done = false; const finish = (value?: string): void => { if (done) return; done = true; renderer.destroy(); resolve(value?.trim() || undefined); }; field.on(InputRenderableEvents.ENTER, () => finish(field.value)); renderer.keyInput.on("keypress", (key) => { if (key.name === "escape" || (key.ctrl && key.name === "c")) finish(); }); });
}

async function featureForm(existing?: { slug: string; title: string; summary?: string; scopes?: string[]; responsibilities?: string[]; invariants?: string[]; validation?: string[] }): Promise<FeaturePlan | undefined> {
  const slug = existing?.slug ?? await input("Feature identifier", "checkout-flow"); if (!slug) return undefined;
  const title = await input("Feature title", "Checkout flow", existing?.title); if (!title) return undefined;
  const summary = await input("Feature purpose", "What capability this feature provides", existing?.summary); if (!summary) return undefined;
  const scopes = await input("Feature scopes", "src/checkout/**,tests/checkout/**", existing?.scopes?.join(",")); if (!scopes) return undefined;
  const responsibilities = await input("Responsibilities · optional", "Own checkout orchestration", existing?.responsibilities?.join(","));
  const invariants = await input("Invariants · optional", "Never charge twice", existing?.invariants?.join(","));
  const validation = await input("Validation · optional", "npm test", existing?.validation?.join(","));
  return existing ? { kind: "edit", slug, title, summary, scopes, responsibilities, invariants, validation } : { kind: "add", slug, title, summary, scopes, responsibilities, invariants, validation };
}

export async function manageFeatures(root: string): Promise<FeaturePlan | undefined> {
  const facts = await readFacts(root);
  const features = facts.knowledgeGraph?.nodes.filter((node) => node.kind === "feature" || node.kind === "concern") ?? [];
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const rootBox = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background, padding: 1, gap: 1 }); renderer.root.add(rootBox);
  addText(renderer, rootBox, "HarnessME  Feature Manager", { height: 1, fg: COLORS.accent });
  const select = new SelectRenderable(renderer, { options: features.map((node) => ({ name: node.label, description: `${node.kind} · ${node.provenance}`, value: node.id.replace(/^[^:]+:/u, "") })), flexGrow: 1, focusedBackgroundColor: COLORS.panel, selectedBackgroundColor: COLORS.selected, selectedTextColor: "#ffffff", textColor: COLORS.text, descriptionColor: COLORS.muted, showDescription: true, wrapSelection: true }); rootBox.add(select);
  addText(renderer, rootBox, "n add   e edit   x remove   l link   u unlink   Esc/q back", { height: 1, fg: COLORS.muted }); select.focus();
  return new Promise((resolve) => { let done = false; const finish = (plan?: FeaturePlan): void => { if (done) return; done = true; renderer.destroy(); resolve(plan); }; select.on(SelectRenderableEvents.ITEM_SELECTED, () => {}); renderer.keyInput.on("keypress", (key) => {
    if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) finish();
    else if (key.name === "x") { const slug = select.getSelectedOption()?.value; if (typeof slug === "string") finish({ kind: "remove", slug }); }
    else if (key.name === "n") { done = true; renderer.destroy(); void featureForm().then(resolve); }
    else if (key.name === "e") { const slug = select.getSelectedOption()?.value; const node = facts.knowledgeGraph?.nodes.find((item) => item.id.endsWith(`:${slug}`)); if (typeof slug === "string" && node) { done = true; renderer.destroy(); const source = facts.featureOverrides?.features.find((item) => item.slug === slug) ?? facts.featurePack?.features.find((item) => item.slug === slug); void featureForm({ slug, title: node.label, summary: node.summary, scopes: source?.scopes, responsibilities: source?.responsibilities, invariants: source?.invariants, validation: source?.validation }).then(resolve); } }
    else if (key.name === "l" || key.name === "u") { const from = select.getSelectedOption()?.value; if (typeof from === "string") { done = true; renderer.destroy(); void input("Target feature", "target-feature").then(async (to) => { if (!to) return resolve(undefined); const relation = await input("Relationship kind", "depends-on", "depends-on"); if (relation !== "depends-on" && relation !== "related-to") return resolve(undefined); resolve({ kind: key.name === "l" ? "link" : "unlink", from, to, relationshipKind: relation }); }); } }
  }); });
}
