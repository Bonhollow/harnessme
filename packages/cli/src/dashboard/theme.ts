import { TextRenderable, type BoxRenderable, type CliRenderer } from "@opentui/core";

export const COLORS = {
  background: "#0b1020", panel: "#121a2e", border: "#334155", accent: "#22d3ee",
  selected: "#164e63", text: "#e2e8f0", muted: "#94a3b8", success: "#4ade80",
  warning: "#fbbf24", danger: "#fb7185", blue: "#075985",
} as const;

export function addText(renderer: CliRenderer, parent: BoxRenderable, content: string, options: ConstructorParameters<typeof TextRenderable>[1] = {}): TextRenderable {
  const text = new TextRenderable(renderer, { content, fg: COLORS.text, wrapMode: "word", ...options });
  parent.add(text);
  return text;
}
