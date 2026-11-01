"""Daily rollups of the gateway exports, for the growers' dashboard."""

import polars as pl


def daily_stats(path: str) -> pl.DataFrame:
    raise NotImplementedError
