import { describe, expect, it } from "vitest";
import { createProgress, info, warn, withOutputSink } from "../packages/cli/src/output.js";
import { buildGatePlan } from "../packages/cli/src/dashboard/gate-plan.js";

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

  it("builds a single gate plan that activates proposals and removes selected active gates", () => {
    const plan = buildGatePlan([
      { glob: "src/auth.ts", status: "proposed" },
      { glob: "src/store.ts", status: "active" },
      { glob: "src/client.ts", status: "active" },
    ], new Set(["src/auth.ts", "src/store.ts"]));
    expect(plan).toEqual({ activate: ["src/auth.ts"], remove: ["src/store.ts"] });
  });
});
