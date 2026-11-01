"""Behaviour of shipping.report as shipped on polars 0.19.19, which the upgrade must keep.

Every assertion here passes against the original module on polars 0.19.19.
"""

from datetime import date

import polars as pl

from shipping import report


def frame(**columns) -> pl.DataFrame:
    return pl.DataFrame(columns)


def test_load_shipments_schema(tmp_path):
    path = tmp_path / "export.csv"
    path.write_text(
        "shipment_id,ship_date,carrier,recipient,postcode,weight_g,volume_cm3,tags\n"
        "007001,2026-10-04,PNL,Iris Bakker,0123 ab,10,20,gift\n"
    )
    df = report.load_shipments(str(path))
    assert df.columns == ["shipment_id", "ship_date", "carrier", "recipient", "postcode", "weight_g", "volume_cm3", "tags"]
    assert df.row(0) == ("007001", date(2026, 10, 4), "PNL", "Iris Bakker", "0123 ab", 10, 20, "gift")


def test_normalize_postcodes_values():
    df = frame(postcode=["1011 ab", " 2512cd ", "3011EF"])
    assert report.normalize_postcodes(df)["postcode"].to_list() == ["1011AB", "2512CD", "3011EF"]


def test_unknown_carrier_codes_get_a_null_name():
    df = frame(carrier=["UPS", "XPO", "DHL", "dhl", "PNL"])
    out = report.with_carrier_names(df)
    assert out.columns == ["carrier", "carrier_name"]
    assert out["carrier_name"].to_list() == ["UPS", None, "DHL Express", None, "PostNL"]
    assert out.schema["carrier_name"] == pl.Utf8


def test_label_bytes_are_utf8_bytes_not_characters():
    names = [
        "José Müller",
        "Zoë Østergård-Ærøskøbing Sørensen A/S",  # 37 characters, 44 bytes
        "Plain Ascii Name Of Exactly Forty Chars.",  # 40 characters, 40 bytes
        "Ana",
    ]
    out = report.label_check(frame(recipient=names))
    assert out.columns == ["recipient", "recipient_bytes", "too_long"]
    assert out["recipient_bytes"].to_list() == [len(n.encode()) for n in names]
    assert out["too_long"].to_list() == [False, True, False, False]


def test_shipments_per_day_columns():
    df = frame(ship_date=[date(2026, 10, 2), date(2026, 10, 1), date(2026, 10, 2)])
    out = report.shipments_per_day(df)
    assert out.columns == ["ship_date", "count"]
    assert out.rows() == [(date(2026, 10, 1), 1), (date(2026, 10, 2), 2)]


def test_daily_weight_columns():
    df = frame(ship_date=[date(2026, 10, 2), date(2026, 10, 1), date(2026, 10, 2)], weight_g=[5, 7, 11])
    out = report.daily_weight(df)
    assert out.columns == ["ship_date", "shipments", "total_weight_g", "cumulative_weight_g"]
    assert out.rows() == [(date(2026, 10, 1), 1, 7, 7), (date(2026, 10, 2), 2, 16, 23)]


def test_carrier_counts_columns_and_order():
    df = frame(carrier=["UPS", "DHL", "UPS", "GLS", "DHL", "UPS"])
    out = report.carrier_counts(df)
    assert out.columns == ["carrier", "counts"]
    assert out.rows() == [("UPS", 3), ("DHL", 2), ("GLS", 1)]


def test_merge_stock_keeps_skus_from_either_warehouse():
    a = frame(sku=["S-1", "S-2", "S-4"], on_hand=[5, 0, 2])
    b = frame(sku=["S-3", "S-2", "S-5"], on_hand=[9, 7, 1])
    out = report.merge_stock(a, b)
    assert out.columns == ["sku", "on_hand_a", "on_hand_b", "total"]
    assert out.rows() == [
        ("S-1", 5, 0, 5),
        ("S-2", 0, 7, 7),
        ("S-3", 0, 9, 9),
        ("S-4", 2, 0, 2),
        ("S-5", 0, 1, 1),
    ]


def test_tag_rows_keep_skus_without_approved_tags():
    df = frame(
        sku=["A", "B", "C", "D", "E"],
        tags=["gift| fragile", "legacy-x|promo2019", None, "hazmat", " |"],
    )
    assert report.tag_rows(df).rows() == [
        ("A", "gift"),
        ("A", "fragile"),
        ("B", None),
        ("C", None),
        ("D", "hazmat"),
        ("E", None),
    ]


def test_route_strings_single_and_multi_leg():
    legs = frame(shipment_id=["X", "Y", "X"], leg_no=[2, 1, 1], hub=["BRU", "MAD", "LIS"])
    assert report.route_strings(legs).rows() == [("X", "LIS-BRU"), ("Y", "MAD")]


def test_manifest_lines_numbering():
    out = report.manifest_lines(frame(shipment_id=["c", "a", "b"]))
    assert out.columns == ["line_no", "shipment_id"]
    assert out.rows() == [(1, "c"), (2, "a"), (3, "b")]


def test_weights_long_values():
    df = frame(shipment_id=["s1", "s2"], weight_g=[100, 200], volume_cm3=[10, 20], carrier=["UPS", "DHL"])
    assert report.weights_long(df).rows() == [
        ("s1", "weight_g", 100),
        ("s2", "weight_g", 200),
        ("s1", "volume_cm3", 10),
        ("s2", "volume_cm3", 20),
    ]
