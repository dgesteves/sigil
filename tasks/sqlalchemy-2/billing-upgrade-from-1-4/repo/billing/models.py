from sqlalchemy import Column, Date, ForeignKey, Integer, String, Table
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True)
    email = Column(String(254), unique=True, nullable=False)
    name = Column(String(200), nullable=False)

    invoices = relationship("Invoice", backref="customer")


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True)
    number = Column(String(32), unique=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    # issued -> paid, or issued -> void
    status = Column(String(16), nullable=False, default="issued")
    issued_on = Column(Date, nullable=False)
    total_cents = Column(Integer, nullable=False, default=0)

    lines = relationship("InvoiceLine", backref="invoice", order_by="InvoiceLine.id")


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id = Column(Integer, primary_key=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    description = Column(String(200), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_cents = Column(Integer, nullable=False)


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
