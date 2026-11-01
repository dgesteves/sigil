"""Regenerates export.csv deterministically: python generate.py (stdlib only)."""

import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent


def main() -> None:
    rng = random.Random(4242)
    rows = []
    start = datetime(2026, 10, 1)
    for sensor, base_t, base_h in [("gh1-north", 17.0, 72.0), ("gh1-south", 19.5, 66.0), ("gh2-center", 21.0, 60.0)]:
        t = start + timedelta(minutes=rng.randrange(10))
        while t < start + timedelta(days=5):
            temp = f"{base_t + rng.uniform(-3, 3):.2f}"
            hum = f"{base_h + rng.uniform(-8, 8):.1f}"
            r = rng.random()
            if r < 0.06:
                temp = "NaN"
            elif r < 0.09:
                temp = ""
            r = rng.random()
            if r < 0.05:
                hum = "NaN"
            elif r < 0.07:
                hum = ""
            # gh2-center's temperature probe was dead for all of 3 October.
            if sensor == "gh2-center" and t.date() == datetime(2026, 10, 3).date():
                temp = "NaN"
            rows.append({"sensor_id": sensor, "recorded_at": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                         "temperature_c": temp, "humidity_pct": hum})
            t += timedelta(minutes=rng.choice([9, 10, 10, 11]))
    rows.sort(key=lambda r: r["recorded_at"])
    with open(HERE / "export.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["sensor_id", "recorded_at", "temperature_c", "humidity_pct"])
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
