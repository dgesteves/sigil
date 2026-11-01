"""Per-order and per-customer views built from the event stream."""

import polars as pl


def order_timeline(events: pl.LazyFrame, orders: pl.LazyFrame) -> pl.LazyFrame:
    raise NotImplementedError


def customer_spend(events: pl.LazyFrame, orders: pl.LazyFrame) -> pl.LazyFrame:
    raise NotImplementedError
