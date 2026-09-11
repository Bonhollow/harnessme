import { defineCommand, runMain } from "citty";
import init from "./commands/init.js";
import scan from "./commands/scan.js";
import sync from "./commands/sync.js";
import check from "./commands/check.js";
import validate from "./commands/validate.js";
import directive from "./commands/directive.js";
import providers from "./commands/providers.js";
import critical from "./commands/critical.js";
import criticalGate from "./commands/critical-gate.js";
import hooks from "./commands/hooks.js";
import targets from "./commands/targets.js";
import quality from "./commands/quality.js";
import refresh from "./commands/refresh.js";
import feature from "./commands/feature.js";
import generation from "./commands/generation.js";
import context from "./commands/context.js";
import { HARNESSME_VERSION } from "@harnessme/core";
import { dashboard } from "./dashboard.js";

const main = defineCommand({
  meta: {
    name: "harnessme",
    version: HARNESSME_VERSION,
    description: "Derive and govern AI coding-agent instructions from repository evidence.",
  },
  subCommands: {
    init,
    scan,
    sync,
    validate,
    check,
    directive,
    providers,
    targets,
    critical,
    "critical-gate": criticalGate,
    hooks,
    quality,
    refresh,
    feature,
    generation,
    context,
  },
  run: async () => {
    if (process.argv.length <= 2) await dashboard();
  },
});

runMain(main);
