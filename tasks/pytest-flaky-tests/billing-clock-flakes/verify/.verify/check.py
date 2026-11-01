"""Verifier for billing-clock-flakes: the suite must pass at any date, time of day and local timezone,
and still catch real bugs in billing."""

from pathlib import Path

from harness import Condition, Suite

HERE = Path(__file__).resolve().parent

# (UTC instant, process timezone, why it is interesting)
INSTANTS = [
    ("2026-06-20T12:00:00+00:00", "UTC", "an ordinary afternoon"),
    ("2026-12-15T12:00:00+00:00", "UTC", "December"),
    ("2027-01-30T12:00:00+00:00", "UTC", "the 30th, before a short month"),
    ("2026-09-10T12:00:00+00:00", "UTC", "ten days after the 31st"),
    ("2028-02-29T12:00:00+00:00", "UTC", "a leap day"),
    ("2026-07-15T22:30:00+00:00", "Pacific/Auckland", "Auckland morning, UTC still yesterday"),
    ("2026-07-16T03:00:00+00:00", "America/Los_Angeles", "Los Angeles evening, UTC already tomorrow"),
    ("2026-10-24T08:30:00+00:00", "Europe/Lisbon", "the day before Lisbon leaves summer time"),
]

suite = Suite()
suite.require_random_order_enabled()
suite.stability(
    [
        Condition(
            f"{instant} TZ={tz} ({why})",
            ["-p", "flaky_clock", "-p", "randomly", f"--randomly-seed={seed}"],
            {"FLAKY_NOW": instant, "TZ": tz, "PYTHONHASHSEED": str(seed)},
        )
        for seed, (instant, tz, why) in enumerate(INSTANTS, start=1)
    ]
)
benign = {"FLAKY_NOW": INSTANTS[0][0], "TZ": "UTC"}
suite.mutants(HERE / "mutants", ["-p", "flaky_clock"], benign)
suite.finish()
