import { defineCommand } from "citty";
import { providers } from "@harnessme/renderers";
import { info } from "../output.js";

const list = defineCommand({
  meta: { name: "list", description: "List harness output targets" },
  run() {
    for (const provider of providers) info(`${provider.id.padEnd(14)} ${provider.label} (${provider.nativeArtifact})`);
  },
});

export default defineCommand({
  meta: { name: "targets", description: "Inspect harness output targets" },
  subCommands: { list },
});
