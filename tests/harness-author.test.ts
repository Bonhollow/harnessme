import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { FactsSnapshot } from "@harnessme/core";
import { authorHarnessWithAi } from "../packages/analyzers/src/harness-author.js";
import type { AnalysisResult } from "../packages/analyzers/src/types.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

function harnessMarkdown(includeArchitecture: boolean): string {
  return `# Repository instructions

## Stack

No languages or frameworks were detected.

${includeArchitecture ? "## Architecture\n\nNo stable module boundaries were detected.\n\n" : ""}## Coding conventions

Follow repository-local configuration.

## Validation

No validation command was detected.

## Critical-path safety gate

Before editing a listed path, stop and ask the developer for explicit confirmation. Never self-approve or bypass the gate.

{{HARNESSME_CRITICAL_PATHS}}

## Verified material changes

{{HARNESSME_VERIFIED_CHANGES}}

## Project directives

{{HARNESSME_DIRECTIVES}}

## Keeping this harness current

{{HARNESSME_PENDING}}`;
}

describe("AI harness authoring", () => {
  it("repairs a reviewed document that omits a required section", async () => {
    let requests = 0;
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.once("end", () => {
        requests += 1;
        const payload = JSON.parse(body) as { response_format?: { json_schema?: { name?: string } } };
        const schema = payload.response_format?.json_schema?.name;
        const result = schema === "harnessme_agents_draft"
          ? { markdown: harnessMarkdown(true), gates: [] }
          : schema === "harnessme_agents_review"
            ? { markdown: harnessMarkdown(false), gates: [], comparison: "The draft was shortened." }
            : { markdown: harnessMarkdown(true), gates: [], comparison: "Restored the required architecture section." };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");

    const facts: FactsSnapshot = {
      config: { schemaVersion: 1, targets: ["codex"], languages: [], analysis: { exclude: [], maxFileBytes: 1000 }, distribution: { backend: "native" } },
      conventions: { schemaVersion: 1, generatedAt: new Date().toISOString(), facts: [] },
      stack: { schemaVersion: 1, generatedAt: new Date().toISOString(), languages: [], packageManagers: [], frameworks: [], dependencies: [], topLevelModules: [] },
      evidence: [],
      architecture: "# Observed architecture\n\nNo stable module boundaries were detected.\n",
      directives: "# Project directives\n",
      criticalPaths: { schemaVersion: 1, paths: [], heuristics: { enabled: true, minChanges: 25, minFanIn: 5, minScore: 25 } },
      changes: { schemaVersion: 1, changes: [] },
    };
    const analysis: AnalysisResult = {
      conventions: facts.conventions,
      stack: facts.stack,
      evidence: [],
      architecture: facts.architecture,
      hotspots: [],
      warnings: [],
      sourceFiles: [],
      commands: [],
    };
    const result = await authorHarnessWithAi({
      facts,
      analysis,
      deterministicBaseline: "# Repository instructions\n\n## Observed architecture\n\nNo stable module boundaries were detected.\n",
      inference: {
        enabled: true,
        provider: "http",
        frameworks: [],
        endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
        model: "test-model",
        apiKeyEnv: "",
        maxFiles: 20,
        maxFileBytes: 65_536,
        include: ["**/*"],
        exclude: [],
      },
    });

    expect(result.markdown).toContain("## Architecture");
    expect(result.comparison).toContain("Restored");
    expect(requests).toBe(3);
  });
});
