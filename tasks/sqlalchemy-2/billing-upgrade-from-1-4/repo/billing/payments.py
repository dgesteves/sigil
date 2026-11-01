"""Payments and receivables (Core). Shared with the bank feed importer and the finance exports."""

import datetime as dt

from sqlalchemy import func, select, text

from billing.models import customers, invoices, payments


def record_payment(engine, invoice_id, amount_cents, received_on, method="card"):
    """Stores a payment and marks the invoice paid once it is fully covered. Returns the payment id."""
    result = engine.execute(
        payments.insert().values(
            invoice_id=invoice_id,
            amount_cents=amount_cents,
            received_on=received_on,
            method=method,
        )
    )
    payment_id = result.inserted_primary_key[0]
    paid = engine.execute(
        select([func.coalesce(func.sum(payments.c.amount_cents), 0)]).where(
            payments.c.invoice_id == invoice_id
        )
    ).scalar()
    total = engine.execute(
        select([invoices.c.total_cents]).where(invoices.c.id == invoice_id)
    ).scalar()
    if paid >= total:
        engine.execute(
            invoices.update()
            .where(invoices.c.id == invoice_id, invoices.c.status == "issued")
            .values(status="paid")
        )
    return payment_id


def payments_for_invoice(engine, invoice_id):
    """Plain dicts, one per payment, oldest first. The finance export serializes these as-is."""
    rows = engine.execute(
        select([payments])
        .where(payments.c.invoice_id == invoice_id)
        .order_by(payments.c.received_on, payments.c.id)
    ).fetchall()
    return [dict(row) for row in rows]


def outstanding_by_customer(engine):
    """{customer email: cents still owed on issued invoices}, for customers who owe something."""
    paid = (
        select([payments.c.invoice_id, func.sum(payments.c.amount_cents).label("paid")])
        .group_by(payments.c.invoice_id)
        .alias("paid")
    )
    stmt = (
        select(
            [
                customers.c.email,
                func.sum(invoices.c.total_cents - func.coalesce(paid.c.paid, 0)).label(
                    "outstanding"
                ),
            ]
        )
        .select_from(
            customers.join(invoices).outerjoin(paid, paid.c.invoice_id == invoices.c.id)
        )
        .where(invoices.c.status == "issued")
        .group_by(customers.c.email)
        .order_by(customers.c.email)
    )
    return {row["email"]: row["outstanding"] for row in engine.execute(stmt) if row["outstanding"] > 0}


def apply_late_fees(engine, as_of, fee_cents):
    """Adds a flat fee to every issued invoice more than 30 days old. Returns how many changed."""
    cutoff = as_of - dt.timedelta(days=30)
    with engine.connect() as conn:
        result = conn.execute(
            text(
                "UPDATE invoices SET total_cents = total_cents + :fee "
                "WHERE status = 'issued' AND issued_on < :cutoff"
            ),
            fee=fee_cents,
            cutoff=cutoff.isoformat(),
        )
        return result.rowcount
