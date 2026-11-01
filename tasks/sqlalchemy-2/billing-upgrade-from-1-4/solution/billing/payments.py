"""Payments and receivables (Core). Shared with the bank feed importer and the finance exports."""

import datetime as dt

from sqlalchemy import func, select, text

from billing.models import customers, invoices, payments


def record_payment(engine, invoice_id, amount_cents, received_on, method="card"):
    """Stores a payment and marks the invoice paid once it is fully covered. Returns the payment id."""
    # engine.begin() commits on success; a 2.x Connection never autocommits, so work done on a
    # plain engine.connect() without conn.commit() is rolled back when the block exits.
    with engine.begin() as conn:
        result = conn.execute(
            payments.insert().values(
                invoice_id=invoice_id,
                amount_cents=amount_cents,
                received_on=received_on,
                method=method,
            )
        )
        payment_id = result.inserted_primary_key[0]
        paid = conn.execute(
            select(func.coalesce(func.sum(payments.c.amount_cents), 0)).where(
                payments.c.invoice_id == invoice_id
            )
        ).scalar()
        total = conn.execute(
            select(invoices.c.total_cents).where(invoices.c.id == invoice_id)
        ).scalar()
        if paid >= total:
            conn.execute(
                invoices.update()
                .where(invoices.c.id == invoice_id, invoices.c.status == "issued")
                .values(status="paid")
            )
    return payment_id


def payments_for_invoice(engine, invoice_id):
    """Plain dicts, one per payment, oldest first. The finance export serializes these as-is."""
    with engine.connect() as conn:
        result = conn.execute(
            select(payments)
            .where(payments.c.invoice_id == invoice_id)
            .order_by(payments.c.received_on, payments.c.id)
        )
        return [dict(row._mapping) for row in result]


def outstanding_by_customer(engine):
    """{customer email: cents still owed on issued invoices}, for customers who owe something."""
    paid = (
        select(payments.c.invoice_id, func.sum(payments.c.amount_cents).label("paid"))
        .group_by(payments.c.invoice_id)
        .subquery("paid")
    )
    stmt = (
        select(
            customers.c.email,
            func.sum(invoices.c.total_cents - func.coalesce(paid.c.paid, 0)).label("outstanding"),
        )
        .select_from(
            customers.join(invoices).outerjoin(paid, paid.c.invoice_id == invoices.c.id)
        )
        .where(invoices.c.status == "issued")
        .group_by(customers.c.email)
        .order_by(customers.c.email)
    )
    with engine.connect() as conn:
        return {row.email: row.outstanding for row in conn.execute(stmt) if row.outstanding > 0}


def apply_late_fees(engine, as_of, fee_cents):
    """Adds a flat fee to every issued invoice more than 30 days old. Returns how many changed."""
    cutoff = as_of - dt.timedelta(days=30)
    with engine.begin() as conn:
        result = conn.execute(
            text(
                "UPDATE invoices SET total_cents = total_cents + :fee "
                "WHERE status = 'issued' AND issued_on < :cutoff"
            ),
            {"fee": fee_cents, "cutoff": cutoff.isoformat()},
        )
        return result.rowcount
