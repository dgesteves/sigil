"""Invoice lifecycle (ORM). Each function commits its own unit of work."""

from sqlalchemy.orm import joinedload

from billing.models import Customer, Invoice, InvoiceLine


def create_invoice(session, customer_email, number, issued_on, lines):
    """lines: iterable of (description, quantity, unit_cents). Returns the new invoice id."""
    customer = session.query(Customer).filter_by(email=customer_email).one()
    invoice = Invoice(number=number, customer=customer, issued_on=issued_on)
    session.add(invoice)
    total = 0
    for description, quantity, unit_cents in lines:
        InvoiceLine(
            invoice=invoice, description=description, quantity=quantity, unit_cents=unit_cents
        )
        total += quantity * unit_cents
    invoice.total_cents = total
    session.commit()
    return invoice.id


def add_line(session, invoice_id, description, quantity, unit_cents):
    """Adds a line to an issued invoice and returns the new line id."""
    invoice = session.query(Invoice).get(invoice_id)
    if invoice is None:
        raise LookupError(f"invoice {invoice_id} not found")
    if invoice.status != "issued":
        raise ValueError(f"invoice {invoice.number} is {invoice.status}")
    line = InvoiceLine(description=description, quantity=quantity, unit_cents=unit_cents)
    line.invoice = invoice
    invoice.total_cents += quantity * unit_cents
    session.commit()
    return line.id


def void_invoice(session, number):
    invoice = session.query(Invoice).filter_by(number=number).one()
    if invoice.status == "paid":
        raise ValueError(f"invoice {number} is already paid")
    invoice.status = "void"
    session.commit()


def invoice_summary(session, number):
    invoice = (
        session.query(Invoice)
        .options(joinedload("lines"), joinedload("customer"))
        .filter_by(number=number)
        .first()
    )
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
