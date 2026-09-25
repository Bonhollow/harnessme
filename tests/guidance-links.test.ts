import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditGuidanceLinks, markdownLinkTargets } from "../packages/cli/src/guidance-links.js";

describe("generated guidance links", () => {
  it("ignores external and anchor links but catches missing local targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-links-"));
    await mkdir(join(root, ".harnessme", "agent-pack"), { recursive: true });
    await writeFile(join(root, "AGENTS.md"), "[guide](.harnessme/agent-pack/agent.md) [broken](missing.md) [web](https://example.org) [section](#top)\n");
    await writeFile(join(root, ".harnessme", "agent-pack", "agent.md"), "# Agent\n");
    expect(markdownLinkTargets("[web](https://example.org) [section](#top) [local](../x.md)")).toEqual(["../x.md"]);
    expect(await auditGuidanceLinks(root, ["AGENTS.md"])).toEqual([{ source: "AGENTS.md", target: "missing.md" }]);
  });
});
