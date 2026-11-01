import datetime as dt
import sqlite3

import pytest

from billing.invoices import invoice_summary, void_invoice
from billing.payments import outstanding_by_customer, payments_for_invoice


def test_invoice_summary(session_factory):
    with session_factory() as session:
        summary = invoice_summary(session, "INV-0010")
        missing = invoice_summary(session, "INV-9999")
    assert summary == {
        "number": "INV-0010",
        "customer": "acme@example.org",
        "status": "issued",
        "issued_on": dt.date(2026, 8, 1),
        "total_cents": 12000,
        "lines": [("Consulting day", 2, 5000), ("Travel", 1, 2000)],
    }
    assert missing is None


def test_payments_for_invoice(engine):
    assert payments_for_invoice(engine, 10) == [
        {
            "id": 1000,
            "invoice_id": 10,
            "amount_cents": 4000,
            "received_on": dt.date(2026, 8, 20),
            "method": "transfer",
        },
        {
            "id": 1002,
            "invoice_id": 10,
            "amount_cents": 1000,
            "received_on": dt.date(2026, 8, 20),
            "method": "card",
        },
    ]
    assert payments_for_invoice(engine, 11) == []


def test_outstanding_by_customer(engine):
    # INV-0013 is fully paid but still "issued", so Globex owes nothing.
    assert outstanding_by_customer(engine) == {
        "acme@example.org": 7000 + 5000,
        "initech@example.org": 2500,
    }


def test_void_invoice(session_factory, db_path):
    with session_factory() as session:
        void_invoice(session, "INV-0011")
        with pytest.raises(ValueError):
            void_invoice(session, "INV-0012")
    with sqlite3.connect(db_path) as raw:
        status = raw.execute("SELECT status FROM invoices WHERE number = 'INV-0011'").fetchone()
    raw.close()
    assert status == ("void",)
