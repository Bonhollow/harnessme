import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { protectedEntryCandidates } from "../packages/analyzers/src/protected-candidates.js";

describe("protected entry candidates", () => {
  it("resolves explicit Python methods only when file ownership is unambiguous", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-protected-entry-"));
    try {
      await writeFile(join(root, "agent_handler.py"), "class AgentHandler:\n    async def handle_request(self):\n        pass\n");
      await writeFile(join(root, "main.py"), "def start_server():\n    pass\n");
      await writeFile(join(root, "other.py"), "def start_server():\n    pass\n");
      await mkdir(join(root, "tests"));
      await writeFile(join(root, "tests", "test_main.py"), "def start_server():\n    pass\n");
      const candidates = await protectedEntryCandidates(root, ["agent_handler.py", "main.py", "other.py"],
        "- Do not touch the main entry methods unless the owner approves:\n  `AgentHandler.handle_request()`, `start_server()`.\n");
      expect(candidates).toEqual([expect.objectContaining({ path: "agent_handler.py", methods: ["AgentHandler.handle_request()"] })]);
      expect(candidates.some((candidate) => candidate.path === "main.py" || candidate.path === "other.py")).toBe(false);
      const withTest = await protectedEntryCandidates(root, ["main.py", "tests/test_main.py"],
        "- Do not edit entry methods without approval:\n  `start_server()`.\n");
      expect(withTest).toEqual([expect.objectContaining({ path: "main.py", methods: ["start_server()"] })]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
