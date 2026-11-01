"""Verifier for order-dependent-flags: the suite must pass in any order and in isolation, and still
catch real bugs in flagship."""

from pathlib import Path

from harness import Condition, Suite

HERE = Path(__file__).resolve().parent

suite = Suite()
suite.require_random_order_enabled()
suite.stability(
    [Condition(f"random order, seed {seed}", ["-p", "randomly", f"--randomly-seed={seed}"],
               {"PYTHONHASHSEED": str(seed)}) for seed in (1, 2, 3, 5, 8, 13)]
    + [Condition("reverse file order", ["-p", "no:randomly", "-p", "flaky_reverse"])]
)
suite.isolation()
suite.mutants(HERE / "mutants")
suite.finish()
