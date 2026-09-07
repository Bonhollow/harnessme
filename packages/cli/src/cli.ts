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

const main = defineCommand({
  meta: {
    name: "harnessme",
    version: "0.1.0",
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
  },
});

runMain(main);
