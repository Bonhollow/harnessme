import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { expect, it } from "vitest";
import { managedHarnessWorkflowPath, renderHarnessWorkflow } from "../packages/core/src/governance-artifacts.js";

const exec = promisify(execFile);

it("passes pull-request base branches to the CI gate as shell data", async () => {
  const root = await mkdtemp(join(tmpdir(), "harnessme-workflow-"));
  await renderHarnessWorkflow(root);
  const source = await readFile(join(root, ".github", "workflows", "harnessme.yml"), "utf8");
  const workflow = yaml.load(source) as { jobs: { harness: { steps: Array<{ if?: string; run?: string; env?: Record<string, string> }> } } };
  const step = workflow.jobs.harness.steps.find((item) => item.if === "github.event_name == 'pull_request'");
  expect(step?.run).toBeDefined();
  const branch = "probe$(id)";
  const run = step!.run!.replaceAll("${{ github.base_ref }}", branch);
  const script = `npx() { printf '%s\\n' "$@"; }\n${run}`;
  const result = await exec("bash", ["-c", script], {
    cwd: root,
    env: { ...process.env, HARNESSME_BASE_REF: branch },
  });
  expect(result.stdout).toContain(`origin/${branch}\n`);
  expect(step?.env?.HARNESSME_BASE_REF).toBe("${{ github.base_ref }}");
});

it("runs the critical gate for direct pushes to main", async () => {
  const root = await mkdtemp(join(tmpdir(), "harnessme-push-workflow-"));
  await renderHarnessWorkflow(root);
  const source = await readFile(join(root, ".github", "workflows", "harnessme.yml"), "utf8");
  const workflow = yaml.load(source) as { jobs: { harness: { steps: Array<{ if?: string; run?: string; env?: Record<string, string> }> } } };
  const step = workflow.jobs.harness.steps.find((item) => item.if === "github.event_name == 'push' && github.event.before != '0000000000000000000000000000000000000000'");
  expect(step?.env?.HARNESSME_BASE_SHA).toBe("${{ github.event.before }}");
  expect(step?.run).toContain("critical-gate --base \"$HARNESSME_BASE_SHA\"");
});

it("installs a managed CI gate beside a user-owned workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "harnessme-custom-workflow-"));
  const primary = join(root, ".github", "workflows", "harnessme.yml");
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(primary, "name: User workflow\non: push\njobs: {}\n");
  expect(await managedHarnessWorkflowPath(root)).toBe(".github/workflows/harnessme-generated.yml");
  expect(await renderHarnessWorkflow(root)).toBe(".github/workflows/harnessme-generated.yml");
  expect(await readFile(primary, "utf8")).toBe("name: User workflow\non: push\njobs: {}\n");
  expect(await readFile(join(root, ".github", "workflows", "harnessme-generated.yml"), "utf8")).toContain("critical-gate");
});
