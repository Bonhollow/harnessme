export interface Provider {
  id: string;
  label: string;
  rulerId: string;
  nativeArtifact: string;
}

export const providers: Provider[] = [
  { id: "codex", label: "OpenAI Codex", rulerId: "codex", nativeArtifact: "AGENTS.md" },
  { id: "claude-code", label: "Claude Code", rulerId: "claude", nativeArtifact: "CLAUDE.md" },
  { id: "cursor", label: "Cursor", rulerId: "cursor", nativeArtifact: "AGENTS.md" },
  { id: "opencode", label: "OpenCode", rulerId: "opencode", nativeArtifact: "AGENTS.md" },
  { id: "copilot", label: "GitHub Copilot", rulerId: "copilot", nativeArtifact: "AGENTS.md" },
  { id: "windsurf", label: "Windsurf", rulerId: "windsurf", nativeArtifact: "AGENTS.md" },
  { id: "gemini-cli", label: "Gemini CLI", rulerId: "gemini-cli", nativeArtifact: ".gemini/settings.json" },
  { id: "antigravity", label: "Google Antigravity", rulerId: "antigravity", nativeArtifact: ".agent/rules/ruler.md" },
  { id: "cline", label: "Cline", rulerId: "cline", nativeArtifact: ".clinerules" },
  { id: "aider", label: "Aider", rulerId: "aider", nativeArtifact: ".aider.conf.yml" },
  { id: "zed", label: "Zed", rulerId: "zed", nativeArtifact: "AGENTS.md" },
  { id: "roo", label: "Roo Code", rulerId: "roo", nativeArtifact: "AGENTS.md" },
];

export function resolveProviders(values: string[]): Provider[] {
  const requested = values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const unknown = requested.filter((id) => !providers.some((provider) => provider.id === id));
  if (unknown.length) throw new Error(`Unknown output target(s): ${unknown.join(", ")}. Run \`harnessme targets list\`.`);
  return [...new Map(requested.map((id) => {
    const provider = providers.find((candidate) => candidate.id === id)!;
    return [provider.id, provider];
  })).values()];
}
