"""Per-order and per-customer views built from the event stream."""

import polars as pl

# Event order within an order: by time, then by event_id for events in the same second.
EVENT_ORDER = ["occurred_at", "event_id"]


def order_timeline(events: pl.LazyFrame, orders: pl.LazyFrame) -> pl.LazyFrame:
    """One row per known order with its event count, time bounds and latest two statuses.

    Joins and the streaming engine do not preserve row order, and a sort placed before a join is
    not kept, so every order-dependent aggregation sorts its own values.
    """
    status_in_order = pl.col("status").sort_by(EVENT_ORDER)
    return (
        events.join(orders, on="order_id", how="inner")
        .group_by("order_id")
        .agg(
            pl.col("customer_id").first(),
            pl.col("region").first(),
            pl.len().alias("n_events"),
            pl.col("occurred_at").min().alias("first_event_at"),
            pl.col("occurred_at").max().alias("last_event_at"),
            status_in_order.last().alias("current_status"),
            status_in_order.get(-2, null_on_oob=True).alias("previous_status"),
        )
        .sort("order_id")
    )


def customer_spend(events: pl.LazyFrame, orders: pl.LazyFrame) -> pl.LazyFrame:
    """One row per captured payment or refund with the customer's running spend, in time order."""
    signed = (
        pl.when(pl.col("status") == "refund_issued")
        .then(-pl.col("amount_cents"))
        .otherwise(pl.col("amount_cents"))
    )
    return (
        events.filter(pl.col("status").is_in(["payment_captured", "refund_issued"]))
        .join(orders.select("order_id", "customer_id"), on="order_id", how="inner")
        .with_columns(amount_cents=signed)
        .with_columns(
            spend_to_date_cents=pl.col("amount_cents")
            .cum_sum()
            .over("customer_id", order_by=EVENT_ORDER)
        )
        .select(
            "customer_id",
            "order_id",
            "event_id",
            "occurred_at",
            "amount_cents",
            "spend_to_date_cents",
        )
        .sort(["customer_id", *EVENT_ORDER])
    )
