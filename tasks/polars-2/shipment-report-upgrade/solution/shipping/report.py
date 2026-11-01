"""Daily shipping reports for the warehouse operations team.

Every function takes and returns eager DataFrames; the nightly job writes the results to the ops
dashboard and to the BI exports, so column names and values are part of the contract.
"""

import polars as pl

CARRIERS = {"DHL": "DHL Express", "UPS": "UPS", "PNL": "PostNL", "GLS": "GLS"}

# Tags the storefront understands; anything else in the export is noise from old integrations.
APPROVED_TAGS = ["fragile", "hazmat", "oversize", "cold-chain", "gift"]

# The label printers hold 40 bytes of UTF-8 on the recipient line.
LABEL_LIMIT_BYTES = 40


def load_shipments(path: str) -> pl.DataFrame:
    """The warehouse export. shipment_id and postcode stay strings (leading zeros matter)."""
    return pl.read_csv(
        path,
        schema_overrides={"shipment_id": pl.String, "postcode": pl.String},
        try_parse_dates=True,
    )


def normalize_postcodes(df: pl.DataFrame) -> pl.DataFrame:
    """Postcodes without spaces and upper-cased: '1234 ab' -> '1234AB'."""
    return df.with_columns(pl.col("postcode").str.replace_all(" ", "", literal=True).str.to_uppercase())


def with_carrier_names(df: pl.DataFrame) -> pl.DataFrame:
    """Adds carrier_name. Unknown carrier codes get a null name so ops can spot and fix them."""
    # map_dict mapped unknown values to null; replace() would keep the code itself.
    return df.with_columns(
        pl.col("carrier").replace_strict(CARRIERS, default=None, return_dtype=pl.String).alias("carrier_name")
    )


def label_check(df: pl.DataFrame) -> pl.DataFrame:
    """Adds recipient_bytes (UTF-8 size of the recipient line) and too_long (the printer truncates)."""
    # str.lengths() counted bytes; its character-counting successor is len_chars().
    return df.with_columns(pl.col("recipient").str.len_bytes().alias("recipient_bytes")).with_columns(
        (pl.col("recipient_bytes") > LABEL_LIMIT_BYTES).alias("too_long")
    )


def shipments_per_day(df: pl.DataFrame) -> pl.DataFrame:
    """Columns ship_date and count, one row per day, oldest first."""
    return df.group_by("ship_date").len(name="count").sort("ship_date")


def daily_weight(df: pl.DataFrame) -> pl.DataFrame:
    """ship_date, shipments, total_weight_g and cumulative_weight_g (running total), oldest first."""
    return (
        df.group_by("ship_date")
        .agg(pl.len().alias("shipments"), pl.col("weight_g").sum().alias("total_weight_g"))
        .sort("ship_date")
        .with_columns(pl.col("total_weight_g").cum_sum().alias("cumulative_weight_g"))
    )


def carrier_counts(df: pl.DataFrame) -> pl.DataFrame:
    """Columns carrier and counts, most used carrier first."""
    return df["carrier"].value_counts(sort=True, name="counts")


def merge_stock(warehouse_a: pl.DataFrame, warehouse_b: pl.DataFrame) -> pl.DataFrame:
    """One row per SKU stocked in either warehouse: sku, on_hand_a, on_hand_b, total.

    A SKU missing from one warehouse counts as 0 there.
    """
    # how="outer" coalesced the key columns; how="full" only does so with coalesce=True.
    merged = warehouse_a.join(warehouse_b, on="sku", how="full", coalesce=True, suffix="_b")
    return (
        merged.rename({"on_hand": "on_hand_a"})
        .fill_null(0)
        .with_columns((pl.col("on_hand_a") + pl.col("on_hand_b")).alias("total"))
        .sort("sku")
    )


def tag_rows(df: pl.DataFrame) -> pl.DataFrame:
    """One row per (sku, tag) for the approved tags, in export order.

    Tags are '|'-separated and may carry stray spaces. A SKU with no approved tags keeps one row
    with a null tag, so it still shows up in the tag report.
    """
    approved = pl.element().str.strip_chars()
    return (
        df.select("sku", "tags")
        .with_columns(pl.col("tags").str.split("|").list.eval(approved.filter(approved.is_in(APPROVED_TAGS))))
        # Since Polars 2.0 an empty list explodes to no row unless empty_as_null=True.
        .explode("tags", empty_as_null=True)
        .rename({"tags": "tag"})
    )


def route_strings(legs: pl.DataFrame) -> pl.DataFrame:
    """shipment_id and route: the hubs in leg order joined with '-', e.g. 'AMS-FRA-WAW'."""
    return (
        legs.group_by("shipment_id", maintain_order=True)
        .agg(pl.col("hub").sort_by("leg_no").str.join("-").alias("route"))
        .sort("shipment_id")
    )


def manifest_lines(df: pl.DataFrame) -> pl.DataFrame:
    """Adds line_no, starting at 1, in the order the shipments appear in the export."""
    return df.with_row_index("line_no", offset=1)


def weights_long(df: pl.DataFrame) -> pl.DataFrame:
    """Long format for the BI tool: shipment_id, measure, value."""
    return df.unpivot(
        index="shipment_id",
        on=["weight_g", "volume_cm3"],
        variable_name="measure",
        value_name="value",
    )
