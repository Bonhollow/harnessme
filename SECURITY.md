# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Bonhollow/harnessme/security/advisories/new). Do not open a public issue for secrets exposure, command execution, prompt-injection bypasses, or critical-gate bypasses.

Include the affected HarnessME version, operating system, reproduction steps, and expected impact. Remove real credentials and private repository contents from the report.

## Security boundaries

HarnessME treats repository contents as untrusted input. Model-assisted facts require structured output, exact local citations, and a verification pass. AI output cannot approve critical-path changes; approval remains bound to the staged Git content and an authorized human identity.

No automated filter can guarantee that source sent to a remote model contains no sensitive information. Review inputs with `harnessme init --ai-preview`, maintain `.harnessmeignore`, or use `--deterministic` when repository contents must remain local.
