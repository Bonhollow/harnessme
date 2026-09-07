# Contributing

Use Node.js 20.19 or newer. Install dependencies with `npm install`, then run `npm run lint` and `npm test` before opening a pull request.

Keep analyzers evidence-backed: every new inferred convention needs at least one repository-relative file and line citation. Keep provider-specific behavior in `packages/renderers`; shared facts and governance belong in `packages/core`.

Bug reports should include the HarnessME version, operating system, Node version, command, exit code, and a minimal repository shape that reproduces the issue. Never include secrets or proprietary source excerpts.
