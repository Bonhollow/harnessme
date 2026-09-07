# HarnessME

HarnessME analyzes a repository and turns its real structure and conventions into shared instructions for AI coding agents. It generates `AGENTS.md` and provider-specific files, detects drift, identifies high-impact files from change frequency and import fan-in, and gates invasive changes to critical paths.

It is a local, scriptable CLI: no account, dashboard, or hosted service required.

## Install

Requires Node.js 20.19 or newer on Windows, macOS, or Linux.

```bash
npm install --global harnessme
harnessme --version
```

For model-assisted generation, install and sign in to at least one supported framework CLI: Codex, Claude Code, or Cursor. Use `--deterministic` when you want a fully local run without model inference.

For a one-off run:

```bash
npx harnessme init --provider codex
```

## Use

Initialize HarnessME from the root of an existing repository:

```bash
harnessme init --provider codex --critical-approvers alice,bob
harnessme hooks install
```

The `--provider` value selects the model runtime used for inference; it does not limit generated files. By default HarnessME writes integrations for every supported agent framework. Use `--targets codex,claude-code` only when you intentionally want a smaller output set.

This creates the facts store in `.harnessme/`, a generated `AGENTS.md`, provider files, CODEOWNERS, CI configuration, and a cross-platform Lefthook configuration. The second command activates the local Git gate on macOS, Linux, or Windows.

## How the harness is created

When `harnessme init` runs, it:

1. Scans C#, Java, Go, Rust, Ruby, PHP, C, C++, JavaScript, TypeScript, TSX, Python, Bash, PowerShell, CSS, and INI files using bundled syntax-tree grammars.
2. Reads package metadata, formatter and linter settings, type configuration, contribution documentation, and Git history.
3. Detects the stack, repository structure, coding conventions, error-handling and object-design patterns, import hubs, and frequently changed files.
4. Stores those findings in `.harnessme/facts/`. Every inferred convention includes a repository-relative file and line citation.
5. Marks high-impact files as critical when their change-frequency or import fan-in score crosses the configured thresholds. These rules are written to `.harnessme/critical-paths.yaml` for review and adjustment.
6. Compiles the validated facts, project directives, architecture, and critical-path rules into `AGENTS.md` and the selected provider files.
7. Generates the governance backstops: `.harnessme/CRITICAL.md`, CODEOWNERS, a Claude Code hook when selected, Lefthook configuration, and a GitHub Actions workflow.

Existing unmanaged `AGENTS.md` instructions are preserved as project directives instead of being discarded. Application source files are analyzed but not rewritten.

### Framework model inference and fallback

Model-assisted analysis reuses the authentication and default model from Codex, Claude Code, or Cursor. Choose the inference runtime with `--provider`; `auto` uses the first installed supported CLI:

```text
harnessme init --provider auto
```

Select one explicitly or override its configured model when needed:

```text
harnessme init --provider cursor --model your-model
```

Supported inference runtimes are `codex`, `claude-code`, and `cursor`. HarnessME runs them non-interactively in an isolated temporary directory containing only redacted analysis input—not the repository—and asks for structured, evidence-cited facts. The model enriches deterministic analysis for supported languages and provides fallback analysis for missing grammars. It does not directly write `AGENTS.md` or governance files; HarnessME validates and renders those deterministically.

An OpenAI-compatible endpoint, including a local Ollama server, remains available when no framework CLI is suitable:

```text
harnessme init --provider http --ai-endpoint http://localhost:11434/v1/chat/completions --model qwen2.5-coder:7b
```

For an authenticated endpoint, add `--ai-api-key-env AI_API_KEY`. Model inference examines text-like source files within configured size limits. Secret-like lines are redacted before inference. Proposed facts must pass schema validation, local file-and-line citation checks, and a separate model-verification pass before entering the facts store. Use `--deterministic` to disable model inference for offline or privacy-sensitive runs.

Keep the harness current:

```bash
harnessme scan                 # report differences without writing
harnessme validate             # verify pending notes from AGENTS.md
harnessme sync                 # regenerate provider files
harnessme check --ci           # fail when facts have drifted
```

Add a project policy that cannot be inferred from source code:

```bash
harnessme directive add "Use OAuth2 for authentication"
```

Protect a critical area:

```bash
harnessme critical add "src/payments/**" --reason "money movement" --approvers "alice,bob"
harnessme critical draft "src/payments/refund.ts" --summary "support partial refunds"
# A listed human reviewer reviews the record and staged code, then:
harnessme critical approve <record.md> --approver alice
git add .harnessme/critical-log/<record.md> .harnessme/CRITICAL.md
```

For registered paths, generated agent instructions require explicit developer confirmation before editing. Claude Code receives a native permission prompt; the Git hook and CI reject commits unless an approved record matches the exact staged/committed content and ships with the updated critical index. CODEOWNERS remains the authoritative team-review control on GitHub.

Use `harnessme providers list` to see inference providers and `harnessme targets list` to see generated integration targets. Every command accepts `--root <path>` for automation and monorepos.

## Behind the scenes

- `web-tree-sitter` and VS Code WASM grammars for deterministic multi-language analysis
- `zod` for validating the version-controlled facts store
- `Ruler` for distributing instructions to agent-specific formats
- `js-yaml`, TOML, and frontmatter parsing for project configuration and critical-change records
- Git history for hotspot detection and git-native critical-path checks
- Import-graph fan-in and AST patterns for core-module and architecture detection
- Authenticated Codex, Claude Code, or Cursor CLI sessions for optional model-assisted harness inference
- Claude Code hooks, Lefthook, GitHub Actions, and CODEOWNERS for governance backstops

## Development

```bash
npm install
npm run lint
npm test
```

## License

MIT
