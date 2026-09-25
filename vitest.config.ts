import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@harnessme/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@harnessme/analyzers": fileURLToPath(new URL("./packages/analyzers/src/index.ts", import.meta.url)),
      "@harnessme/renderers": fileURLToPath(new URL("./packages/renderers/src/index.ts", import.meta.url)),
    },
  },
});
