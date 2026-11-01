"""Ticket workflow. Every function commits its own unit of work."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from helpdesk.models import Comment, Ticket

PRIORITIES = (1, 2, 3, 4)
OPEN_STATUSES = ("open", "pending")


def open_ticket(
    session: Session, subject: str, priority: int, assignee_id: int | None = None
) -> Ticket:
    if priority not in PRIORITIES:
        raise ValueError(f"priority must be one of {PRIORITIES}")
    ticket = Ticket(subject=subject, priority=priority, assignee_id=assignee_id)
    session.add(ticket)
    session.commit()
    return ticket


def get_ticket(session: Session, ticket_id: int) -> Ticket | None:
    return session.get(Ticket, ticket_id)


def _require(session: Session, ticket_id: int) -> Ticket:
    ticket = session.get(Ticket, ticket_id)
    if ticket is None:
        raise LookupError(f"ticket {ticket_id} not found")
    return ticket


def assign(session: Session, ticket_id: int, agent_id: int) -> Ticket:
    ticket = _require(session, ticket_id)
    ticket.assignee_id = agent_id
    session.commit()
    return ticket


def add_comment(session: Session, ticket_id: int, author_id: int, body: str) -> Comment:
    ticket = _require(session, ticket_id)
    if ticket.status == "closed":
        raise ValueError("ticket is closed")
    comment = Comment(ticket=ticket, author_id=author_id, body=body)
    session.add(comment)
    # An agent reply hands the ticket back to the customer.
    ticket.status = "pending"
    session.commit()
    return comment


def close_ticket(session: Session, ticket_id: int) -> Ticket:
    ticket = _require(session, ticket_id)
    ticket.status = "closed"
    session.commit()
    return ticket


def open_queue(session: Session, assignee_id: int | None = None) -> list[Ticket]:
    stmt = (
        select(Ticket)
        .where(Ticket.status.in_(OPEN_STATUSES))
        .order_by(Ticket.priority, Ticket.id)
    )
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    return list(session.scalars(stmt))
