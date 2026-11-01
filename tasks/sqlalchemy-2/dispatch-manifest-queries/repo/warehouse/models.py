from __future__ import annotations

import datetime as dt

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True)
    name: Mapped[str]

    shipments: Mapped[list[Shipment]] = relationship(back_populates="warehouse")


class Carrier(Base):
    __tablename__ = "carriers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    service_level: Mapped[str] = mapped_column(String(16))


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str]


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(32), unique=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    carrier_id: Mapped[int] = mapped_column(ForeignKey("carriers.id"))
    dispatch_date: Mapped[dt.date]
    # Free text from the order desk, e.g. "call before delivery".
    instructions: Mapped[str | None]

    warehouse: Mapped[Warehouse] = relationship(back_populates="shipments")
    carrier: Mapped[Carrier] = relationship()
    parcels: Mapped[list[Parcel]] = relationship(back_populates="shipment")


class Parcel(Base):
    __tablename__ = "parcels"

    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id"))
    label: Mapped[str] = mapped_column(String(16))
    weight_grams: Mapped[int]

    shipment: Mapped[Shipment] = relationship(back_populates="parcels")
    items: Mapped[list[ParcelItem]] = relationship(back_populates="parcel")


class ParcelItem(Base):
    __tablename__ = "parcel_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    parcel_id: Mapped[int] = mapped_column(ForeignKey("parcels.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int]

    parcel: Mapped[Parcel] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()
