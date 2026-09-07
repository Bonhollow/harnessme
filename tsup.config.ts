import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "packages/cli/src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["@intellectronica/ruler", "@vscode/tree-sitter-wasm", "web-tree-sitter"],
});
