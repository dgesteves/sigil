"""Hidden verifier harness for flaky-test tasks.

It runs the project's own test suite (as left by the agent) many times under conditions that expose
flakiness, then runs it against known-broken copies of the library to prove the tests still test
something. Every run is a fresh pytest process in a fresh copy of the project with its own TMPDIR, so
nothing can leak between runs and runs can go in parallel.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path.cwd()
HERE = Path(__file__).resolve().parent
SCRATCH = Path(tempfile.mkdtemp(prefix="flaky-verify-"))
IGNORE_PROJECT = shutil.ignore_patterns(".venv", ".verify", "__pycache__", ".pytest_cache", ".git")


def _local_python() -> str:
    """Use a container-local copy of the venv: imports from a bind mount are several times slower."""
    source = ROOT / ".venv"
    target = SCRATCH / "venv"
    try:
        shutil.copytree(source, target, symlinks=True, ignore=shutil.ignore_patterns("pip", "pip-*"))
        return str(target / "bin" / "python")
    except OSError:
        return str(source / "bin" / "python")


PYTHON = _local_python()


@dataclass
class Condition:
    label: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class Result:
    label: str
    code: int
    output: str


def _env(extra: dict[str, str], tmp: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("PYTEST_")}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONPATH"] = str(HERE / "plugins")
    env["TMPDIR"] = str(tmp)
    env.update(extra)
    return env


_counter = iter(range(1_000_000))


def run_pytest(
    label: str, args: list[str], env: dict[str, str] | None = None, overlay: Path | None = None
) -> Result:
    """Run pytest in a private copy of the project, optionally with files overlaid on it."""
    run_dir = SCRATCH / f"run-{next(_counter)}"
    work, tmp = run_dir / "project", run_dir / "tmp"
    shutil.copytree(ROOT, work, ignore=IGNORE_PROJECT, symlinks=True)
    if overlay is not None:
        shutil.copytree(overlay, work, dirs_exist_ok=True)
    tmp.mkdir()
    cmd = [PYTHON, "-m", "pytest", "-p", "no:cacheprovider", *args]
    try:
        proc = subprocess.run(
            cmd, cwd=work, env=_env(env or {}, tmp), capture_output=True, text=True, timeout=60
        )
        result = Result(label, proc.returncode, proc.stdout + proc.stderr)
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        result = Result(label, 124, out + "\n[timed out after 60s]")
    shutil.rmtree(run_dir, ignore_errors=True)
    return result


def run_all(jobs: list[tuple]) -> list[Result]:
    with ThreadPoolExecutor(max_workers=max(2, min(8, os.cpu_count() or 2))) as pool:
        return list(pool.map(lambda job: run_pytest(*job), jobs))


def tail(text: str, lines: int = 30) -> str:
    return "\n".join(text.rstrip().splitlines()[-lines:])


class Suite:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.passed: list[str] = []

    def fail(self, message: str) -> None:
        self.failures.append(message)
        print(f"FAIL {message.splitlines()[0]}")

    def ok(self, message: str) -> None:
        self.passed.append(message)
        print(f"ok   {message}")

    def require_random_order_enabled(self) -> None:
        """CI runs with pytest-randomly; turning it off is not a fix."""
        config = tomllib.loads((ROOT / "pyproject.toml").read_text())
        ini = config.get("tool", {}).get("pytest", {})
        opts = ini.get("ini_options", ini).get("addopts", "")
        opts = " ".join(opts) if isinstance(opts, list) else str(opts)
        if re.search(r"no:\s*randomly|randomly-dont-reorganize|randomly-dont-reset-seed", opts):
            self.fail(f"pytest-randomly is disabled in addopts: {opts!r}")

    def stability(self, conditions: list[Condition], forbid: tuple[str, ...] = ()) -> None:
        """The whole suite must pass under every condition (and not print any `forbid` text)."""
        results = run_all([(c.label, ["-q", *c.args], c.env) for c in conditions])
        for res in results:
            if res.code == 5:
                self.fail(f"no tests collected under {res.label}")
            elif res.code != 0:
                self.fail(f"suite failed under {res.label} (exit {res.code})\n{tail(res.output)}")
            elif hits := [text for text in forbid if text in res.output]:
                self.fail(f"suite output under {res.label} contains {hits[0]!r}\n{tail(res.output)}")
            else:
                self.ok(f"stable under {res.label}")

    def collect_functions(self) -> list[str]:
        res = run_pytest("collect", ["--collect-only", "-q", "-p", "no:randomly"])
        ids = []
        for line in res.output.splitlines():
            line = line.strip()
            if "::" in line and not line.startswith(("ERROR", "FAILED")):
                ids.append(line.split("[", 1)[0])
        return list(dict.fromkeys(ids))

    def isolation(self, env: dict[str, str] | None = None) -> None:
        """Each test function must pass when it is the only thing that runs."""
        functions = self.collect_functions()
        if not functions:
            self.fail("could not collect any tests")
            return
        results = run_all([(node, ["-q", "-p", "no:randomly", node], env) for node in functions])
        broken = [res for res in results if res.code != 0]
        if broken:
            names = ", ".join(res.label for res in broken)
            self.fail(
                f"{len(broken)} test(s) fail when run on their own: {names}\n{tail(broken[0].output)}"
            )
        else:
            self.ok(f"each of {len(functions)} test functions passes on its own")

    def mutants(
        self, mutants_dir: Path, args: list[str] | None = None, env: dict[str, str] | None = None
    ) -> None:
        """The suite must fail (exit 1, a test failure) against every known-broken library copy."""
        names = sorted(p.name for p in mutants_dir.iterdir() if p.is_dir())
        argv = ["-q", "-p", "no:randomly", "-x", *(args or [])]
        jobs = [(name, argv, env, mutants_dir / name) for name in names]
        survivors = [res for res in run_all(jobs) if res.code != 1]
        if survivors:
            listed = ", ".join(f"{res.label} (exit {res.code})" for res in survivors)
            self.fail(
                f"the tests no longer catch {len(survivors)} of {len(names)} known bugs: {listed}\n"
                + tail(survivors[0].output, 15)
            )
        else:
            self.ok(f"the tests catch all {len(names)} known bugs")

    def finish(self) -> None:
        shutil.rmtree(SCRATCH, ignore_errors=True)
        print()
        if self.failures:
            print(f"{len(self.failures)} check(s) failed")
            for message in self.failures:
                print("-" * 70)
                print(message)
            sys.exit(1)
        print(f"all {len(self.passed)} checks passed")
        sys.exit(0)
