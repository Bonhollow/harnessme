import { createRequire } from "node:module";
import type { Provider } from "./providers.js";

const require = createRequire(import.meta.url);

type ApplyRuler = (
  projectRoot: string,
  includedAgents?: string[],
  configPath?: string,
  cliMcpEnabled?: boolean,
  cliMcpStrategy?: "merge" | "overwrite",
  cliGitignoreEnabled?: boolean,
  verbose?: boolean,
  dryRun?: boolean,
  localOnly?: boolean,
  nested?: boolean,
  backup?: boolean,
  skillsEnabled?: boolean,
  cliGitignoreLocal?: boolean,
  subagentsEnabled?: boolean,
) => Promise<void>;

export async function applyRuler(root: string, selected: Provider[]): Promise<void> {
  const ruler = require("@intellectronica/ruler") as { applyAllAgentConfigs: ApplyRuler };
  await ruler.applyAllAgentConfigs(
    root,
    selected.map((provider) => provider.rulerId),
    undefined, // configPath
    false, // MCP propagation
    "merge",
    false, // .gitignore updates
    false, // verbose
    false, // dryRun
    false, // localOnly
    false, // nested
    false, // HarnessME already protects unmanaged files and writes atomically
    false, // skills
    false, // local .gitignore
    false, // subagents
  );
}
