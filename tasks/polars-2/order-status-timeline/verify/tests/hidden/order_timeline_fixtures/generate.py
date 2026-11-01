"""Regenerates events.csv and orders.csv deterministically: python generate.py (stdlib only)."""

import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
FLOW = ["created", "payment_captured", "packed", "shipped", "delivered"]


def main() -> None:
    rng = random.Random(20261101)
    orders = []
    for i in range(600):
        orders.append({"order_id": 50_000 + i, "customer_id": 700 + rng.randrange(140),
                       "region": rng.choice(["eu-west", "eu-north", "us-east", "us-west", "apac"])})
    events = []
    next_id = {p: p * 1_000_000 for p in range(1, 5)}  # four producers, separate id ranges
    start = datetime(2026, 9, 1)
    # Orders 50_590.. never appear in orders.csv (purged), but their events stay in the export.
    purged = [{"order_id": 60_000 + i, "customer_id": 0, "region": ""} for i in range(25)]
    for order in orders + purged:
        t = start + timedelta(seconds=rng.randrange(60 * 60 * 24 * 40))
        n = rng.randrange(1, len(FLOW) + 1)
        steps = FLOW[:n]
        if n >= 2 and rng.random() < 0.15:
            steps = steps + ["refund_issued", "cancelled"]
        elif n <= 2 and rng.random() < 0.2:
            steps = steps + ["cancelled"]
        if n >= 2 and rng.random() < 0.1:
            steps = steps[:2] + ["payment_captured"] + steps[2:]  # a second capture (split payment)
        producer = rng.randrange(1, 5)
        for step in steps:
            # About one step in six lands in the same second as the previous one.
            if rng.random() >= 1 / 6:
                t = t + timedelta(seconds=rng.randrange(1, 60 * 60 * 30))
            next_id[producer] += rng.randrange(1, 4)
            amount = ""
            if step == "payment_captured":
                amount = str(rng.randrange(500, 40_000))
            elif step == "refund_issued":
                amount = str(rng.randrange(100, 2_000))
            events.append({"event_id": next_id[producer], "order_id": order["order_id"],
                           "occurred_at": t.strftime("%Y-%m-%dT%H:%M:%S"), "status": step,
                           "amount_cents": amount})
    rng.shuffle(events)
    with open(HERE / "orders.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["order_id", "customer_id", "region"])
        w.writeheader()
        w.writerows(orders)
    with open(HERE / "events.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["event_id", "order_id", "occurred_at", "status", "amount_cents"])
        w.writeheader()
        w.writerows(events)


if __name__ == "__main__":
    main()
