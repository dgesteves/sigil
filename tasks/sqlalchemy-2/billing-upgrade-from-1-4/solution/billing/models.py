from __future__ import annotations

import datetime as dt

from sqlalchemy import Column, Date, ForeignKey, Integer, String, Table
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(200))

    invoices: Mapped[list[Invoice]] = relationship(back_populates="customer")


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(32), unique=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    # issued -> paid, or issued -> void
    status: Mapped[str] = mapped_column(String(16), default="issued")
    issued_on: Mapped[dt.date] = mapped_column(Date)
    total_cents: Mapped[int] = mapped_column(default=0)

    customer: Mapped[Customer] = relationship(back_populates="invoices")
    lines: Mapped[list[InvoiceLine]] = relationship(
        back_populates="invoice", order_by="InvoiceLine.id"
    )


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"))
    description: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[int]
    unit_cents: Mapped[int]

    invoice: Mapped[Invoice] = relationship(back_populates="lines")


# Payments come from the bank feed importer, which predates the ORM models.
payments = Table(
    "payments",
    Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("invoice_id", Integer, ForeignKey("invoices.id"), nullable=False),
    Column("amount_cents", Integer, nullable=False),
    Column("received_on", Date, nullable=False),
    Column("method", String(16), nullable=False),
)

customers = Customer.__table__
invoices = Invoice.__table__
