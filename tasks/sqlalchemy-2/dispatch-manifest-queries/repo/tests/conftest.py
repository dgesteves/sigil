import datetime as dt

import pytest

from warehouse.db import init_db, make_engine, make_sessionmaker
from warehouse.models import Carrier, Parcel, ParcelItem, Product, Shipment, Warehouse

DAY = dt.date(2026, 11, 2)


@pytest.fixture
def day():
    return DAY


@pytest.fixture
def engine(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'warehouse.db'}")
    init_db(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(engine):
    return make_sessionmaker(engine)


@pytest.fixture
def small_site(session_factory):
    with session_factory.begin() as session:
        north = Warehouse(code="NTH", name="North")
        south = Warehouse(code="STH", name="South")
        dhl = Carrier(name="DHL", service_level="express")
        post = Carrier(name="Royal Mail", service_level="standard")
        mug = Product(sku="MUG-01", name="Mug")
        tea = Product(sku="TEA-12", name="Tea, 12 pack")
        session.add_all([north, south, dhl, post, mug, tea])
        s1 = Shipment(reference="S-1002", warehouse=north, carrier=dhl, dispatch_date=DAY)
        s2 = Shipment(
            reference="S-1001",
            warehouse=north,
            carrier=post,
            dispatch_date=DAY,
            instructions="Leave with reception",
        )
        s3 = Shipment(reference="S-1003", warehouse=south, carrier=dhl, dispatch_date=DAY)
        s4 = Shipment(
            reference="S-0999", warehouse=north, carrier=dhl, dispatch_date=DAY - dt.timedelta(days=1)
        )
        session.add_all([s1, s2, s3, s4])
        p1 = Parcel(shipment=s1, label="B", weight_grams=500)
        p2 = Parcel(shipment=s1, label="A", weight_grams=1200)
        p3 = Parcel(shipment=s2, label="A", weight_grams=300)
        session.add_all([p1, p2, p3])
        session.add_all(
            [
                ParcelItem(parcel=p1, product=tea, quantity=2),
                ParcelItem(parcel=p1, product=mug, quantity=1),
                ParcelItem(parcel=p2, product=mug, quantity=4),
            ]
        )
