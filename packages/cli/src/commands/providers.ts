import { defineCommand } from "citty";
import { info } from "../output.js";

const list = defineCommand({
  meta: { name: "list", description: "List model-inference providers" },
  run() {
    info("auto           First available authenticated framework CLI");
    info("codex          OpenAI Codex CLI");
    info("claude-code    Claude Code CLI (alias: claude)");
    info("cursor         Cursor Agent CLI");
    info("http           OpenAI-compatible chat-completions endpoint");
  },
});

export default defineCommand({
  meta: { name: "providers", description: "Inspect model-inference providers" },
  subCommands: { list },
});
