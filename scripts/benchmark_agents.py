#!/usr/bin/env python3
"""Run paired, private Codex harness trials from a local JSON manifest.

The manifest and all trial outputs belong outside this repository. Example:
{"model":"gpt-6-sol","reasoning":"medium","timeoutSeconds":900,
 "tasks":[{"id":"case-1","repo":"/private/repo","base":"parent-sha",
 "fix":"fix-sha","prompt":"Implement the requested behavior...",
 "goldFiles":["tests/test_behavior.py"],"verify":["python -m pytest tests/test_behavior.py"],
 "conditions":{"baseline":{"removeInstructions":false},
               "candidate":{"removeInstructions":true,"setup":["node /path/to/harnessme/dist/cli.js init --root . --targets codex"]}}}]}
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time


def command(argv: list[str], cwd: Path, timeout: int | None = None, output: Path | None = None) -> subprocess.CompletedProcess[str]:
    started = time.monotonic()
    if output:
        with output.open("w", encoding="utf-8") as stream:
            result = subprocess.run(argv, cwd=cwd, text=True, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout, check=False)
    else:
        result = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, timeout=timeout, check=False)
    result.duration = round(time.monotonic() - started, 1)  # type: ignore[attr-defined]
    return result


def git(repo: Path, *args: str) -> str:
    result = command(["git", *args], repo)
    if result.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {result.stderr}")
    return result.stdout.strip()


def remove_instructions(work: Path) -> None:
    tracked = git(work, "ls-files").splitlines()
    for name in tracked:
        path = Path(name)
        if path.name.lower() == "agents.md" or path.parts[:1] in [(".agents",), (".cursor",), (".codex",)]:
            target = work / path
            if target.is_file() or target.is_symlink():
                target.unlink()
    for name in (".agents", ".cursor", ".codex", ".harnessme", ".ruler"):
        shutil.rmtree(work / name, ignore_errors=True)


def usage(events: Path) -> dict[str, int]:
    result = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0}
    for line in events.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "turn.completed":
            values = event.get("usage", {})
            for key in result:
                result[key] = int(values.get(key, result[key]))
    return result


def prepare(task: dict, condition: str, output: Path) -> tuple[Path, dict]:
    repo = Path(task["repo"]).expanduser().resolve()
    base, fix = task["base"], task["fix"]
    if command(["git", "merge-base", "--is-ancestor", base, fix], repo).returncode or base == fix:
        raise ValueError(f"{task['id']}: base must be an ancestor of the hidden fix")
    work = output / "work"
    cloned = command(["git", "clone", "--shared", "--quiet", "--no-checkout", str(repo), str(work)], output)
    if cloned.returncode:
        raise RuntimeError(f"Could not clone the frozen fixture for {task['id']}")
    git(work, "checkout", "--quiet", base)
    if git(work, "rev-parse", "HEAD") != git(repo, "rev-parse", base):
        raise RuntimeError("Fixture checkout did not match the frozen base")
    # Keep future commits out of ordinary agent-visible history and branch refs.
    for ref in git(work, "for-each-ref", "--format=%(refname)").splitlines():
        git(work, "update-ref", "-d", ref)
    git(work, "remote", "remove", "origin")
    config = task["conditions"][condition]
    if config.get("removeInstructions"):
        remove_instructions(work)
    setup = []
    for script in config.get("setup", []):
        result = command(["bash", "-lc", script], work, timeout=1800, output=output / f"setup-{len(setup)}.log")
        setup.append({"command": script, "exitCode": result.returncode, "seconds": result.duration})  # type: ignore[attr-defined]
        if result.returncode:
            raise RuntimeError(f"{task['id']} {condition}: setup failed; see {output / f'setup-{len(setup)-1}.log'}")
    return work, {"base": git(work, "rev-parse", "HEAD"), "setup": setup}


def verify(task: dict, work: Path, output: Path) -> list[dict]:
    for path in task.get("goldFiles", []):
        relative = Path(path)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Unsafe gold path: {path}")
        content = command(["git", "show", f"{task['fix']}:{path}"], Path(task["repo"]))
        if content.returncode:
            raise RuntimeError(f"Gold test missing at {task['fix']}:{path}")
        target = work / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.stdout, encoding="utf-8")
    results = []
    for index, script in enumerate(task["verify"]):
        result = command(["bash", "-lc", script], work, timeout=task.get("verifyTimeoutSeconds", 600), output=output / f"verify-{index}.log")
        results.append({"command": script, "exitCode": result.returncode, "seconds": result.duration})  # type: ignore[attr-defined]
    return results


def run_task(task: dict, condition: str, config: dict, output: Path) -> dict:
    output.mkdir(parents=True)
    work, fixture = prepare(task, condition, output)
    events = output / "codex.jsonl"
    args = ["codex", "exec", "--json", "--ephemeral", "-s", "workspace-write", "-m", config.get("model", "gpt-6-sol"),
            "-c", f'model_reasoning_effort="{config.get("reasoning", "medium")}"', task["prompt"]]
    try:
        agent = command(args, work, timeout=config.get("timeoutSeconds", 900), output=events)
        exit_code = agent.returncode
        duration = agent.duration  # type: ignore[attr-defined]
    except subprocess.TimeoutExpired:
        exit_code = 124
        duration = config.get("timeoutSeconds", 900)
    changed = git(work, "status", "--short").splitlines()
    protected = [path for path in task.get("protectedPaths", []) if path in git(work, "diff", "--name-only").splitlines()]
    checks = verify(task, work, output)
    return {"task": task["id"], "condition": condition, "repo": task["repo"], "fixture": fixture,
            "agentExitCode": exit_code, "agentSeconds": duration, "usage": usage(events), "changed": changed,
            "protectedEdits": protected, "verify": checks, "passed": exit_code == 0 and not protected and all(item["exitCode"] == 0 for item in checks)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--condition", choices=["baseline", "candidate", "both"], default="both")
    args = parser.parse_args()
    manifest_path = args.manifest.expanduser().resolve()
    if manifest_path == Path.cwd().resolve() or Path.cwd().resolve() in manifest_path.parents:
        parser.error("Benchmark manifest must be outside the public repository")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output = args.output.expanduser().resolve()
    if output == Path.cwd().resolve() or Path.cwd().resolve() in output.parents:
        parser.error("Benchmark output must be outside the public repository")
    output.mkdir(parents=True, exist_ok=True)
    results = []
    conditions = ["baseline", "candidate"] if args.condition == "both" else [args.condition]
    for task in manifest["tasks"]:
        for condition in conditions:
            print(f"Running {task['id']} / {condition}", flush=True)
            result = run_task(task, condition, manifest, output / task["id"] / condition)
            results.append(result)
            (output / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    rows = ["| Task | Condition | Passed | Input tokens | Agent seconds |", "|---|---|---:|---:|---:|"]
    rows += [f"| {item['task']} | {item['condition']} | {item['passed']} | {item['usage']['input_tokens']} | {item['agentSeconds']} |" for item in results]
    (output / "results.md").write_text("# Private HarnessME agent benchmark\n\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return 0 if all(item["passed"] for item in results) else 1


if __name__ == "__main__":
    sys.exit(main())
