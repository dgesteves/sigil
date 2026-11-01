from warehouse.manifest import dispatch_manifest


def test_manifest_for_one_warehouse_and_day(session_factory, small_site, day):
    with session_factory() as session:
        manifest = dispatch_manifest(session, "NTH", day)

    assert manifest == [
        {
            "reference": "S-1001",
            "carrier": "Royal Mail",
            "service_level": "standard",
            "instructions": "Leave with reception",
            "parcel_count": 1,
            "total_weight_grams": 300,
            "parcels": [{"label": "A", "weight_grams": 300, "items": []}],
        },
        {
            "reference": "S-1002",
            "carrier": "DHL",
            "service_level": "express",
            "instructions": None,
            "parcel_count": 2,
            "total_weight_grams": 1700,
            "parcels": [
                {
                    "label": "A",
                    "weight_grams": 1200,
                    "items": [{"sku": "MUG-01", "name": "Mug", "quantity": 4}],
                },
                {
                    "label": "B",
                    "weight_grams": 500,
                    "items": [
                        {"sku": "MUG-01", "name": "Mug", "quantity": 1},
                        {"sku": "TEA-12", "name": "Tea, 12 pack", "quantity": 2},
                    ],
                },
            ],
        },
    ]


def test_other_warehouse(session_factory, small_site, day):
    with session_factory() as session:
        manifest = dispatch_manifest(session, "STH", day)
    assert [(s["reference"], s["parcel_count"], s["parcels"]) for s in manifest] == [
        ("S-1003", 0, [])
    ]
