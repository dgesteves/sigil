"""Daily rollups of the gateway exports, for the growers' dashboard."""

import polars as pl

PROBES = ["temperature_c", "humidity_pct"]


def daily_stats(path: str) -> pl.DataFrame:
    """One row per sensor and UTC day present in the export, oldest first per sensor.

    A failed probe is written as NaN (current firmware) or left empty (old firmware). Polars
    reads the empty field as null but NaN as an ordinary float that poisons mean() and is counted
    by count(), so NaN is turned into null before aggregating.
    """
    readings = pl.read_csv(
        path, schema_overrides={"sensor_id": pl.String, "recorded_at": pl.String, **dict.fromkeys(PROBES, pl.Float64)}
    ).with_columns(
        pl.col(PROBES).fill_nan(None),
        day=pl.col("recorded_at").str.to_datetime("%Y-%m-%dT%H:%M:%SZ", time_zone="UTC").dt.date(),
    )
    temp = pl.col("temperature_c")
    return (
        readings.group_by("sensor_id", "day")
        .agg(
            temp.count().alias("readings"),
            temp.min().alias("temp_min"),
            temp.max().alias("temp_max"),
            temp.mean().alias("temp_mean"),
            pl.col("humidity_pct").mean().alias("humidity_mean"),
        )
        .sort("sensor_id", "day")
    )
