import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readCriticalPaths, writeYaml } from "../packages/core/src/index.js";
import { createProgress, info, warn, withOutputSink } from "../packages/cli/src/output.js";
import { configureAndRefreshInference, runGatePlan } from "../packages/cli/src/dashboard/actions.js";
import { buildGatePlan } from "../packages/cli/src/dashboard/gate-plan.js";

const exec = promisify(execFile);

describe("dashboard command execution", () => {
  it("routes command output through the dashboard sink without terminal writes", async () => {
    const output: string[] = [];
    await withOutputSink({
      info: (message) => output.push(message),
      warn: (message) => output.push(`warning: ${message}`),
      progress: (current, total, message, complete) => output.push(`${complete ? "✓" : "…"} [${current}/${total}] ${message}`),
    }, async () => {
      const progress = createProgress(1);
      progress.step("Analyzing repository");
      warn("A source file needs recovery");
      info("Harness quality: 100/100");
      progress.done("Complete");
    });

    expect(output.join("")).toContain("… [1/1] Analyzing repository");
    expect(output.join("")).toContain("warning: A source file needs recovery");
    expect(output.join("")).toContain("Harness quality: 100/100");
    expect(output.join("")).toContain("✓ [1/1] Complete");
  });

  it("builds a gate plan that activates, removes, and dismisses distinct paths", () => {
    const plan = buildGatePlan([
      { glob: "src/auth.ts", status: "proposed" },
      { glob: "src/store.ts", status: "active" },
      { glob: "src/client.ts", status: "active" },
      { glob: "src/unused.ts", status: "proposed" },
    ], new Set(["src/auth.ts", "src/store.ts"]), new Set(["src/unused.ts"]));
    expect(plan).toEqual({ activate: ["src/auth.ts"], remove: ["src/store.ts"], dismiss: ["src/unused.ts"] });
    expect(buildGatePlan([{ glob: "src/auth.ts", status: "proposed" }], new Set(["src/auth.ts"]), new Set(["src/auth.ts"]))
      .activate).toEqual([]);
  });

  it("leaves inference settings unchanged when the dashboard refresh fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-dashboard-inference-"));
    await writeFile(join(root, "package.json"), '{"name":"fixture","version":"1.0.0"}\n');
    await writeFile(join(root, "service.ts"), "export const service = true;\n");
    await exec(process.execPath, [resolve("dist/cli.js"), "init", "--root", root, "--deterministic", "--targets", "codex"]);
    const configPath = join(root, ".harnessme", "harnessme.yaml");
    const before = await readFile(configPath, "utf8");
    await expect(configureAndRefreshInference(root, { deterministic: false, provider: "codex", model: "fixture-model" }, async () => {
      throw new Error("refresh failed");
    })).rejects.toThrow("refresh failed");
    expect(await readFile(configPath, "utf8")).toBe(before);
  }, 30_000);

  it("leaves earlier gate decisions unapplied when a later dashboard decision fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "harnessme-dashboard-gates-"));
    await writeFile(join(root, "package.json"), '{"name":"fixture","version":"1.0.0"}\n');
    await writeFile(join(root, "service.ts"), "export const service = true;\n");
    await exec(process.execPath, [resolve("dist/cli.js"), "init", "--root", root, "--deterministic", "--targets", "codex"]);
    const configPath = join(root, ".harnessme", "critical-paths.yaml");
    const config = await readCriticalPaths(root);
    config.paths.push({ glob: "service.ts", reason: "Review the service contract", approvers: ["owner"], source: "heuristic", status: "proposed", risk: "shared-core" });
    await writeYaml(configPath, config);
    const before = await readFile(configPath, "utf8");

    await expect(runGatePlan(root, {
      activate: ["service.ts", "missing.ts"], remove: [], dismiss: [],
      reasons: { "service.ts": "Protect the service contract", "missing.ts": "No proposed rule exists" },
    }, () => {})).rejects.toThrow("No proposed critical path exists for: missing.ts");
    expect(await readFile(configPath, "utf8")).toBe(before);
  }, 30_000);
});
