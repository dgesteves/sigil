from datetime import date

import polars as pl

from shipping import report

FIXTURE = "tests/fixtures/shipments.csv"


def shipments() -> pl.DataFrame:
    return report.load_shipments(FIXTURE)


def test_load_keeps_ids_and_postcodes_as_strings():
    df = shipments()
    assert df["shipment_id"].to_list()[:2] == ["000101", "000102"]
    assert df.schema["postcode"] == pl.Utf8
    assert df.schema["ship_date"] == pl.Date


def test_normalize_postcodes():
    assert report.normalize_postcodes(shipments())["postcode"].to_list()[:2] == ["1011AB", "2512CD"]


def test_carrier_names_for_known_carriers():
    named = report.with_carrier_names(shipments())
    assert named["carrier_name"].to_list() == ["UPS", "DHL Express", "UPS", "GLS", "UPS", "DHL Express"]


def test_label_check_short_names():
    checked = report.label_check(shipments())
    assert checked["recipient_bytes"].to_list() == [9, 13, 8, 11, 9, 12]
    assert not checked["too_long"].any()


def test_shipments_per_day():
    assert report.shipments_per_day(shipments()).to_dicts() == [
        {"ship_date": date(2026, 10, 1), "count": 2},
        {"ship_date": date(2026, 10, 2), "count": 3},
        {"ship_date": date(2026, 10, 3), "count": 1},
    ]


def test_daily_weight():
    out = report.daily_weight(shipments())
    assert out["shipments"].to_list() == [2, 3, 1]
    assert out["total_weight_g"].to_list() == [2000, 3750, 4100]
    assert out["cumulative_weight_g"].to_list() == [2000, 5750, 9850]


def test_merge_stock_same_skus():
    a = pl.DataFrame({"sku": ["S-1", "S-2"], "on_hand": [5, 0]})
    b = pl.DataFrame({"sku": ["S-2", "S-1"], "on_hand": [7, 1]})
    out = report.merge_stock(a, b)
    assert out.select("sku", "total").to_dicts() == [
        {"sku": "S-1", "total": 6},
        {"sku": "S-2", "total": 7},
    ]


def test_tag_rows():
    rows = report.tag_rows(shipments().rename({"shipment_id": "sku"}).filter(pl.col("tags").is_not_null()))
    assert rows.rows() == [
        ("000101", "fragile"),
        ("000101", "gift"),
        ("000103", "oversize"),
        ("000103", "fragile"),
        ("000104", "gift"),
        ("000105", "hazmat"),
        ("000106", "oversize"),
    ]


def test_route_strings():
    legs = pl.DataFrame(
        {"shipment_id": ["000101"] * 3 + ["000102"], "leg_no": [2, 1, 3, 1], "hub": ["FRA", "AMS", "WAW", "RTM"]}
    )
    assert report.route_strings(legs).rows() == [("000101", "AMS-FRA-WAW"), ("000102", "RTM")]


def test_manifest_lines():
    assert report.manifest_lines(shipments())["line_no"].to_list() == [1, 2, 3, 4, 5, 6]


def test_weights_long():
    out = report.weights_long(shipments())
    assert out.columns == ["shipment_id", "measure", "value"]
    assert out.height == 12
