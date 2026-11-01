"""Verifier for async-retry-flakes: the suite must not depend on real time, must be order
independent, must have no un-awaited coroutines, and must still catch real bugs in relaykit."""

from pathlib import Path

from harness import Condition, Suite

HERE = Path(__file__).resolve().parent
STALL = {"FLAKY_STALL": "300"}

suite = Suite()
suite.require_random_order_enabled()
suite.stability(
    [Condition("file order", ["-p", "no:randomly"])]
    + [
        Condition(
            f"a runner that stalls 300s after every sleep, random order seed {seed}",
            ["-p", "flaky_stall", "-p", "randomly", f"--randomly-seed={seed}"],
            {**STALL, "PYTHONHASHSEED": str(seed)},
        )
        for seed in (1, 2, 3)
    ]
    + [Condition("stalls, reverse file order", ["-p", "flaky_stall", "-p", "no:randomly", "-p", "flaky_reverse"], STALL)],
    forbid=("was never awaited",),
)
suite.mutants(HERE / "mutants")
suite.finish()
