# Hidden checks for the dispatch manifest: same output as before on a realistic site, in a bounded
# number of queries, without changing how the shared models load relationships by default.
import datetime as dt
import random

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from warehouse.db import init_db, make_engine, make_sessionmaker
from warehouse.manifest import dispatch_manifest
from warehouse.models import (
    Carrier,
    Parcel,
    ParcelItem,
    Product,
    Shipment,
    Warehouse,
)

DAY = dt.date(2026, 11, 3)


def reference_manifest(session: Session, warehouse_code: str, day: dt.date) -> list[dict]:
    """The pre-change implementation, kept verbatim as the source of truth for the output."""
    warehouse = session.scalars(select(Warehouse).where(Warehouse.code == warehouse_code)).one()
    shipments = session.scalars(
        select(Shipment)
        .where(Shipment.warehouse_id == warehouse.id, Shipment.dispatch_date == day)
        .order_by(Shipment.reference)
    ).all()
    manifest = []
    for shipment in shipments:
        parcels = []
        for parcel in sorted(shipment.parcels, key=lambda p: p.label):
            items = [
                {"sku": item.product.sku, "name": item.product.name, "quantity": item.quantity}
                for item in sorted(parcel.items, key=lambda i: i.product.sku)
            ]
            parcels.append(
                {"label": parcel.label, "weight_grams": parcel.weight_grams, "items": items}
            )
        manifest.append(
            {
                "reference": shipment.reference,
                "carrier": shipment.carrier.name,
                "service_level": shipment.carrier.service_level,
                "instructions": shipment.instructions,
                "parcel_count": len(parcels),
                "total_weight_grams": sum(p["weight_grams"] for p in parcels),
                "parcels": parcels,
            }
        )
    return manifest


@pytest.fixture
def big_site(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'big.db'}")
    init_db(engine)
    rng = random.Random(20261103)
    factory = make_sessionmaker(engine)
    with factory.begin() as session:
        sites = [Warehouse(code=c, name=c.title()) for c in ("NTH", "STH", "EST")]
        carriers = [
            Carrier(name=n, service_level=l)
            for n, l in [("DHL", "express"), ("UPS", "standard"), ("DPD", "economy"), ("GLS", "standard")]
        ]
        products = [Product(sku=f"SKU-{n:04d}", name=f"Product {n}") for n in range(120)]
        session.add_all(sites + carriers + products)
        ref = 5000
        for site in sites:
            for day in (DAY - dt.timedelta(days=1), DAY, DAY + dt.timedelta(days=1)):
                for _ in range(45 if site.code == "NTH" else 8):
                    ref += rng.randint(1, 3)
                    shipment = Shipment(
                        reference=f"S-{ref}",
                        warehouse=site,
                        carrier=rng.choice(carriers),
                        dispatch_date=day,
                        instructions=rng.choice([None, None, "Fragile", "Call ahead"]),
                    )
                    session.add(shipment)
                    # Some shipments are booked but not packed yet; some parcels are still empty.
                    for label in rng.sample("ABCDEFG", rng.choice([0, 1, 2, 3, 4])):
                        parcel = Parcel(
                            shipment=shipment, label=label, weight_grams=rng.randint(100, 9000)
                        )
                        session.add(parcel)
                        for product in rng.sample(products, rng.choice([0, 1, 3, 5])):
                            session.add(
                                ParcelItem(parcel=parcel, product=product, quantity=rng.randint(1, 9))
                            )
    yield engine
    engine.dispose()


def count_selects(engine):
    statements = []

    def before(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    return statements, lambda: event.remove(engine, "before_cursor_execute", before)


def test_output_is_unchanged_on_a_big_site(big_site):
    factory = make_sessionmaker(big_site)
    for code in ("NTH", "STH", "EST"):
        with factory() as session:
            expected = reference_manifest(session, code, DAY)
        with factory() as session:
            actual = dispatch_manifest(session, code, DAY)
        assert actual == expected, code
    assert len(expected) == 8
    with factory() as session:
        north = dispatch_manifest(session, "NTH", DAY)
    assert len(north) == 45
    assert any(s["parcel_count"] == 0 for s in north), "fixture should include unpacked shipments"
    assert any(p["items"] == [] for s in north for p in s["parcels"]), "fixture should include empty parcels"


@pytest.mark.parametrize("code", ["NTH", "STH"])
def test_bounded_number_of_queries(big_site, code):
    factory = make_sessionmaker(big_site)
    statements, stop = count_selects(big_site)
    try:
        with factory() as session:
            manifest = dispatch_manifest(session, code, DAY)
    finally:
        stop()
    assert manifest
    assert len(statements) <= 4, f"{len(statements)} SELECT statements:\n" + "\n---\n".join(
        s[:200] for s in statements[:8]
    )


def test_empty_day(big_site):
    factory = make_sessionmaker(big_site)
    with factory() as session:
        assert dispatch_manifest(session, "NTH", DAY + dt.timedelta(days=30)) == []


def test_default_relationship_loading_is_unchanged():
    for attr in (
        Warehouse.shipments,
        Shipment.warehouse,
        Shipment.carrier,
        Shipment.parcels,
        Parcel.shipment,
        Parcel.items,
        ParcelItem.parcel,
        ParcelItem.product,
    ):
        assert attr.property.lazy == "select", f"{attr} default loading changed to {attr.property.lazy!r}"
