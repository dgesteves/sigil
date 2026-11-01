"""Invoice lifecycle (ORM). Each function commits its own unit of work."""

from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload

from billing.models import Customer, Invoice, InvoiceLine


def create_invoice(session, customer_email, number, issued_on, lines):
    """lines: iterable of (description, quantity, unit_cents). Returns the new invoice id."""
    customer = session.scalars(select(Customer).where(Customer.email == customer_email)).one()
    # Children go through the parent's collection: since SQLAlchemy 2.0 an object attached only
    # through a backref (InvoiceLine(invoice=...)) is no longer cascaded into the session.
    invoice = Invoice(
        number=number,
        customer=customer,
        issued_on=issued_on,
        lines=[
            InvoiceLine(description=description, quantity=quantity, unit_cents=unit_cents)
            for description, quantity, unit_cents in lines
        ],
    )
    invoice.total_cents = sum(line.quantity * line.unit_cents for line in invoice.lines)
    session.add(invoice)
    session.commit()
    return invoice.id


def add_line(session, invoice_id, description, quantity, unit_cents):
    """Adds a line to an issued invoice and returns the new line id."""
    invoice = session.get(Invoice, invoice_id)
    if invoice is None:
        raise LookupError(f"invoice {invoice_id} not found")
    if invoice.status != "issued":
        raise ValueError(f"invoice {invoice.number} is {invoice.status}")
    line = InvoiceLine(description=description, quantity=quantity, unit_cents=unit_cents)
    invoice.lines.append(line)
    invoice.total_cents += quantity * unit_cents
    session.commit()
    return line.id


def void_invoice(session, number):
    invoice = session.scalars(select(Invoice).where(Invoice.number == number)).one()
    if invoice.status == "paid":
        raise ValueError(f"invoice {number} is already paid")
    invoice.status = "void"
    session.commit()


def invoice_summary(session, number):
    invoice = session.scalars(
        select(Invoice)
        .where(Invoice.number == number)
        .options(selectinload(Invoice.lines), joinedload(Invoice.customer))
    ).first()
    if invoice is None:
        return None
    return {
        "number": invoice.number,
        "customer": invoice.customer.email,
        "status": invoice.status,
        "issued_on": invoice.issued_on,
        "total_cents": invoice.total_cents,
        "lines": [(l.description, l.quantity, l.unit_cents) for l in invoice.lines],
    }
