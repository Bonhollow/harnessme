import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "packages/cli/src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node26",
  bundle: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["@intellectronica/ruler", "@vscode/tree-sitter-wasm", "web-tree-sitter"],
});
