import { BoxRenderable, InputRenderable, InputRenderableEvents, TextRenderable, createCliRenderer, type CliRenderer } from "@opentui/core";
import { COLORS } from "./theme.js";

function text(renderer: CliRenderer, parent: BoxRenderable, content: string, options: ConstructorParameters<typeof TextRenderable>[1] = {}): void {
  parent.add(new TextRenderable(renderer, { content, fg: COLORS.text, wrapMode: "word", ...options }));
}

/** Returns undefined for an intentionally blank optional field, null when cancelled. */
export async function collectProjectDetails(title: string): Promise<string | undefined | null> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, clearOnShutdown: true });
  const root = new BoxRenderable(renderer, { flexDirection: "column", width: "100%", height: "100%", backgroundColor: COLORS.background, padding: 2, gap: 1 });
  renderer.root.add(root);
  text(renderer, root, title, { height: 1, fg: COLORS.accent });
  text(renderer, root, "Optional context for the harness author: domain rules, architecture constraints, team practices, or known risks that source code cannot reveal.", { height: 3, fg: COLORS.muted });
  const input = new InputRenderable(renderer, { width: "100%", placeholder: "Optional — leave blank to continue", backgroundColor: COLORS.panel, focusedBackgroundColor: COLORS.panel, textColor: COLORS.text, maxLength: 2_000 });
  root.add(input);
  text(renderer, root, "Enter continue  Esc/q cancel", { height: 1, fg: COLORS.muted });
  input.focus();
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | undefined | null): void => {
      if (done) return;
      done = true;
      renderer.destroy();
      resolve(value);
    };
    input.on(InputRenderableEvents.ENTER, () => finish(input.value.trim() || undefined));
    renderer.keyInput.on("keypress", (key) => {
      if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) finish(null);
    });
  });
}
