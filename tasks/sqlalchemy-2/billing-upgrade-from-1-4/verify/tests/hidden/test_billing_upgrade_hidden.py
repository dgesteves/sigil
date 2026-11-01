# Hidden checks for the SQLAlchemy upgrade: every write path must persist exactly what it did on
# 1.4, and every read path must return the same values. Database state is read back with plain
# sqlite3 on a fresh connection, so "written" means committed. These tests pass on the original
# code under SQLAlchemy 1.4.54.
import datetime as dt
import json
import sqlite3

import pytest

from billing.invoices import add_line, create_invoice, invoice_summary, void_invoice
from billing.payments import (
    apply_late_fees,
    outstanding_by_customer,
    payments_for_invoice,
    record_payment,
)


def rows(db_path, sql, *params):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def status_of(db_path, invoice_id):
    return rows(db_path, "SELECT status FROM invoices WHERE id = ?", invoice_id)[0][0]


def test_record_payment_persists_and_settles(engine, db_path):
    first = record_payment(engine, 11, 2000, dt.date(2026, 10, 25))
    assert isinstance(first, int)
    assert rows(
        db_path,
        "SELECT invoice_id, amount_cents, received_on, method FROM payments WHERE id = ?",
        first,
    ) == [(11, 2000, "2026-10-25", "card")]
    assert status_of(db_path, 11) == "issued"

    second = record_payment(engine, 11, 3000, dt.date(2026, 10, 28), method="transfer")
    assert isinstance(second, int) and second != first
    assert status_of(db_path, 11) == "paid"
    assert [p["amount_cents"] for p in payments_for_invoice(engine, 11)] == [2000, 3000]
    assert outstanding_by_customer(engine) == {
        "acme@example.org": 7000,
        "initech@example.org": 2500,
    }


def test_record_payment_never_reopens_a_void_invoice(engine, db_path):
    record_payment(engine, 14, 7000, dt.date(2026, 10, 30), method="transfer")
    assert status_of(db_path, 14) == "void"
    assert rows(db_path, "SELECT count(*) FROM payments WHERE invoice_id = 14") == [(1,)]


def test_apply_late_fees_persists(engine, db_path):
    assert apply_late_fees(engine, dt.date(2026, 10, 31), 1500) == 2
    assert dict(rows(db_path, "SELECT id, total_cents FROM invoices")) == {
        10: 13500,
        11: 5000,
        12: 9900,
        13: 5500,
        14: 7000,
        15: 2500,
    }
    assert apply_late_fees(engine, dt.date(2026, 8, 15), 1500) == 0


def test_create_invoice_persists_invoice_and_lines(session_factory, db_path, engine):
    with session_factory() as session:
        new_id = create_invoice(
            session,
            "globex@example.org",
            "INV-0016",
            dt.date(2026, 10, 30),
            [("Workshop", 1, 80000), ("Materials", 12, 450)],
        )
    assert isinstance(new_id, int)
    assert rows(
        db_path,
        "SELECT number, customer_id, status, issued_on, total_cents FROM invoices WHERE id = ?",
        new_id,
    ) == [("INV-0016", 2, "issued", "2026-10-30", 85400)]
    assert rows(
        db_path,
        "SELECT description, quantity, unit_cents FROM invoice_lines WHERE invoice_id = ? ORDER BY id",
        new_id,
    ) == [("Workshop", 1, 80000), ("Materials", 12, 450)]
    with session_factory() as session:
        assert invoice_summary(session, "INV-0016") == {
            "number": "INV-0016",
            "customer": "globex@example.org",
            "status": "issued",
            "issued_on": dt.date(2026, 10, 30),
            "total_cents": 85400,
            "lines": [("Workshop", 1, 80000), ("Materials", 12, 450)],
        }
    assert outstanding_by_customer(engine)["globex@example.org"] == 85400


def test_add_line_persists_the_line_and_the_total(session_factory, db_path):
    with session_factory() as session:
        line_id = add_line(session, 15, "Backup add-on", 3, 300)
    assert isinstance(line_id, int)
    assert rows(
        db_path, "SELECT invoice_id, description, quantity, unit_cents FROM invoice_lines WHERE id = ?", line_id
    ) == [(15, "Backup add-on", 3, 300)]
    assert rows(db_path, "SELECT total_cents FROM invoices WHERE id = 15") == [(3400,)]
    with session_factory() as session:
        assert invoice_summary(session, "INV-0015")["lines"] == [
            ("Hosting", 1, 2500),
            ("Backup add-on", 3, 300),
        ]


def test_add_line_errors_write_nothing(session_factory, db_path):
    before = rows(db_path, "SELECT count(*), sum(total_cents) FROM invoice_lines JOIN invoices ON invoices.id = invoice_id")
    with session_factory() as session:
        with pytest.raises(LookupError):
            add_line(session, 999, "Nothing", 1, 100)
        with pytest.raises(ValueError):
            add_line(session, 12, "Too late", 1, 100)
    assert rows(db_path, "SELECT count(*), sum(total_cents) FROM invoice_lines JOIN invoices ON invoices.id = invoice_id") == before


def test_void_removes_the_invoice_from_receivables(session_factory, engine, db_path):
    with session_factory() as session:
        void_invoice(session, "INV-0015")
    assert status_of(db_path, 15) == "void"
    assert outstanding_by_customer(engine) == {"acme@example.org": 12000}


def test_payment_listing_is_plain_serializable_dicts(engine):
    listing = payments_for_invoice(engine, 10)
    assert all(type(p) is dict for p in listing)
    assert [list(p) for p in listing] == [["id", "invoice_id", "amount_cents", "received_on", "method"]] * 2
    assert json.loads(json.dumps(listing, default=str))[0]["received_on"] == "2026-08-20"


def test_report_values_are_plain_ints(engine):
    report = outstanding_by_customer(engine)
    assert type(report) is dict
    assert all(type(k) is str and type(v) is int for k, v in report.items())
