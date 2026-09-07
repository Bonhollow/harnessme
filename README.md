# HarnessME

HarnessME analyzes a repository and turns its real structure and conventions into shared instructions for AI coding agents. It generates `AGENTS.md` and provider-specific files, detects drift, identifies high-impact files from change frequency and import fan-in, and gates invasive changes to critical paths.

It is a local, scriptable CLI: no account, dashboard, or hosted service required.

## Install

Requires Node.js 20.19 or newer on Windows, macOS, or Linux.

```bash
npm install -g harnessme
harnessme --version
```

After this, run every command directly as `harnessme …` from the repository you want to analyze.

For model-assisted generation, install and sign in to at least one supported framework CLI: Codex, Claude Code, or Cursor. Use `--deterministic` when you want a fully local run without model inference.



## Use

Initialize HarnessME from the root of an existing repository:

```bash
harnessme init
```

By default, `init` uses the first available signed-in inference CLI and writes integrations for every supported agent framework. If no supported AI CLI is available, `auto` completes with deterministic analysis and reports that fallback. The `--provider` option selects the model runtime used for inference; it does not limit generated files. Use `--targets codex,claude-code` only when you intentionally want a smaller output set.

This creates the facts store in `.harnessme/`, a generated `AGENTS.md`, provider files, CODEOWNERS, CI configuration, and a cross-platform Lefthook configuration. Run `harnessme hooks install` afterward when you want to activate the local Git gate.

Long-running commands display a phase-by-phase progress bar describing the current operation. When output is redirected or running in CI, the same updates are emitted as stable `progress:` log lines.

## How the harness is created

When `harnessme init` runs, it:

1. Scans supported source files with bundled syntax-tree grammars and reads repository configuration and documentation.
2. Reads package metadata, formatter and linter settings, type configuration, contribution documentation, and Git history.
3. Detects the stack, repository structure, coding conventions, error-handling and object-design patterns, import hubs, and frequently changed files.
4. Stores those findings in `.harnessme/facts/`. Every inferred convention includes a repository-relative file and line citation.
5. Records high-impact files as proposed critical paths when their change-frequency or import fan-in score crosses the configured thresholds. Proposed paths do not block edits until a maintainer activates them.
6. Compiles the validated facts, project directives, architecture, and critical-path rules into `AGENTS.md` and the selected provider files.
7. Generates the governance backstops: `.harnessme/CRITICAL.md`, CODEOWNERS, a Claude Code hook when selected, Lefthook configuration, and a GitHub Actions workflow.

Existing unmanaged `AGENTS.md` instructions are preserved as project directives instead of being discarded. Application source files are analyzed but not rewritten.

### Framework model inference and fallback

Model-assisted analysis reuses the authentication and default model from Codex, Claude Code, or Cursor. Choose the analysis runtime with `--provider`; `auto` uses the first installed supported CLI:

```text
harnessme init --provider auto
```

Select one explicitly or override its configured model when needed:

```text
harnessme init --provider cursor --model your-model
```

Supported inference runtimes are `codex`, `claude-code`, and `cursor`. HarnessME runs them non-interactively in an isolated temporary directory containing only redacted analysis input—not the repository—and asks for structured, evidence-cited facts. The model enriches deterministic analysis for supported languages and provides fallback analysis for missing grammars. It does not directly write `AGENTS.md` or governance files; HarnessME validates and renders those deterministically.

For a second opinion, assign a separate reviewer with `--review-provider`. The reviewer receives only locally validated proposed facts and must approve each one before it is stored. A different provider is recommended when available:

```text
harnessme init --provider codex --review-provider claude-code
```

Without `--review-provider`, the selected analysis runtime performs the verification pass. AI review can enrich repository facts, but it cannot approve critical-path changes or alter the deterministic critical-path gate.

An OpenAI-compatible endpoint, including a local Ollama server, remains available when no framework CLI is suitable:

```text
harnessme init --provider http --ai-endpoint http://localhost:11434/v1/chat/completions --model qwen2.5-coder:7b
```

For an authenticated endpoint, add `--ai-api-key-env AI_API_KEY`. The reviewer endpoint equivalents are `--review-ai-endpoint`, `--review-model`, and `--review-ai-api-key-env`. Model inference examines text-like source files within configured size limits. Git-ignored files, common credential paths, `.harnessmeignore` entries, secret-like lines, and prompt-injection-like lines are excluded or redacted before inference. Proposed facts must pass schema validation, local file-and-line citation checks, and model verification before entering the facts store. The audit at `.harnessme/facts/ai-inputs.json` records paths, byte counts, and redaction counts—never file contents.

Preview exactly which files would be included without contacting a model or writing the harness:

```text
harnessme init --ai-preview
```

Use `--ai-include "src/**"`, `--ai-exclude "src/generated/**"`, or add patterns to `.harnessmeignore` for finer control. Use `--deterministic` to disable model inference for offline or privacy-sensitive runs.

## Command reference

Commands that operate on a repository accept `--root <path>` to operate on another repository root. Use `harnessme --help` for built-in help and `harnessme --version` to print the installed version.

| Command | Purpose | Options |
| --- | --- | --- |
| `harnessme init` | Analyze a repository and create the harness. | `--provider auto|codex|claude-code|cursor|http`, `--review-provider …`, `--targets <comma-list>`, `--model <name>`, `--review-model <name>`, `--ai-endpoint <url>`, `--review-ai-endpoint <url>`, `--ai-api-key-env <env>`, `--review-ai-api-key-env <env>`, `--ai-include <comma-list>`, `--ai-exclude <comma-list>`, `--ai-preview`, `--deterministic`, `--critical-approvers <comma-list>`, `--extra-prompt <text>` |
| `harnessme scan` | Report analysis drift without writing. | No command-specific options. |
| `harnessme sync` | Regenerate generated agent files from validated facts. | `--targets <comma-list>` |
| `harnessme validate` | Validate pending agent notes and refresh facts. | `--max-retries <non-negative integer>`, `--ci` |
| `harnessme check` | Fail if committed facts have drifted. | `--ci` |
| `harnessme directive add <text>` | Add a maintainer-authored instruction. | — |
| `harnessme directive list` | Print maintained directives. | — |
| `harnessme critical add <glob>` | Register a critical path. | `--reason <text>` and `--approvers <comma-list>` are required. |
| `harnessme critical list` | List critical-path rules. | — |
| `harnessme critical activate <glob>` | Activate a proposed critical path and regenerate governance files. | — |
| `harnessme critical draft <path>` | Start a review record before changing a critical file. | `--summary <text>` is required. |
| `harnessme critical approve <record.md>` | Bind an approved record to staged content. | `--approver <handle>` is required. |
| `harnessme critical-gate` | Run the critical-path gate (normally invoked by hooks/CI). | `--path <file>` for edit checks, `--base <git-revision>` for CI, or `--hook` for Claude Code hook input. |
| `harnessme hooks install` | Install the generated cross-platform Git pre-commit gate. | — |
| `harnessme hooks status` | Report whether the local gate is installed. | — |
| `harnessme providers list` | List selectable inference providers. | — |
| `harnessme targets list` | List generated integration targets. | — |

`--provider` and `--review-provider` select inference runtimes. `--targets` selects generated instruction formats; the two settings are intentionally independent. The HTTP provider requires `--ai-endpoint` and `--model`; HTTP review requires `--review-ai-endpoint` and `--review-model`.

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

Heuristically detected paths begin as `proposed`. Review them first, then activate an accepted rule:

```bash
harnessme critical list
harnessme critical activate "src/core.ts"
```

For registered paths, generated agent instructions require explicit developer confirmation before editing. Claude Code receives a native permission prompt; the Git hook and CI reject commits unless an approved record matches the exact staged/committed content and ships with the updated critical index. CODEOWNERS remains the authoritative team-review control on GitHub.

## Behind the scenes

- `web-tree-sitter` and VS Code WASM grammars for deterministic multi-language analysis
- `zod` for validating the version-controlled facts store
- `Ruler` for distributing instructions to agent-specific formats
- `js-yaml`, TOML, and frontmatter parsing for project configuration and critical-change records
- Git history for hotspot detection and git-native critical-path checks
- Import-graph fan-in and AST patterns for core-module and architecture detection
- Authenticated Codex, Claude Code, or Cursor CLI sessions for optional model-assisted harness inference
- Claude Code hooks, Lefthook, GitHub Actions, and CODEOWNERS for governance backstops
- Explicit labels distinguishing observed, AI-assisted, maintainer-authored, proposed, and active guidance



## Development

```bash
npm install
npm run lint
npm test
npm run test:package
```

## Publishing

Releases are published through `.github/workflows/release.yml` using npm trusted publishing and provenance. Before the first automated release, configure this GitHub repository and the `release.yml` workflow as a trusted publisher in the npm package settings, enable two-factor authentication on maintainer accounts, and create the protected GitHub environment named `npm`.

Set the version in `package.json`, commit it, create a matching tag such as `v0.2.0`, and publish a GitHub Release from that tag. The workflow rejects a tag that does not match the package version, runs the full test and packaged-install suite, then publishes with provenance.



## License

MIT
