"""Ticket workflow. Every function commits its own unit of work.

Callers serialize the returned objects with plain synchronous code, inside or after the session, so
nothing may be lazy-loaded later: each function returns objects whose attributes and relationships
are already loaded (including values the database generates on UPDATE, such as updated_at).
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from helpdesk.models import Comment, Ticket

PRIORITIES = (1, 2, 3, 4)
OPEN_STATUSES = ("open", "pending")

# Everything ticket_to_dict reads.
TICKET_GRAPH = (
    selectinload(Ticket.assignee),
    selectinload(Ticket.comments).selectinload(Comment.author),
)


async def _load_ticket(session: AsyncSession, ticket_id: int) -> Ticket | None:
    # populate_existing refreshes an instance already in the identity map, including columns the
    # last flush expired (updated_at is set by the database on UPDATE).
    stmt = (
        select(Ticket)
        .where(Ticket.id == ticket_id)
        .options(*TICKET_GRAPH)
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(stmt)).one_or_none()


async def _require(session: AsyncSession, ticket_id: int) -> Ticket:
    ticket = await session.get(Ticket, ticket_id)
    if ticket is None:
        raise LookupError(f"ticket {ticket_id} not found")
    return ticket


async def open_ticket(
    session: AsyncSession, subject: str, priority: int, assignee_id: int | None = None
) -> Ticket:
    if priority not in PRIORITIES:
        raise ValueError(f"priority must be one of {PRIORITIES}")
    ticket = Ticket(subject=subject, priority=priority, assignee_id=assignee_id)
    session.add(ticket)
    await session.commit()
    return await _load_ticket(session, ticket.id)


async def get_ticket(session: AsyncSession, ticket_id: int) -> Ticket | None:
    return await _load_ticket(session, ticket_id)


async def assign(session: AsyncSession, ticket_id: int, agent_id: int) -> Ticket:
    ticket = await _require(session, ticket_id)
    ticket.assignee_id = agent_id
    await session.commit()
    return await _load_ticket(session, ticket_id)


async def add_comment(session: AsyncSession, ticket_id: int, author_id: int, body: str) -> Comment:
    ticket = await _require(session, ticket_id)
    if ticket.status == "closed":
        raise ValueError("ticket is closed")
    comment = Comment(ticket=ticket, author_id=author_id, body=body)
    session.add(comment)
    # An agent reply hands the ticket back to the customer.
    ticket.status = "pending"
    await session.commit()
    await session.refresh(comment, ["author"])
    return comment


async def close_ticket(session: AsyncSession, ticket_id: int) -> Ticket:
    ticket = await _require(session, ticket_id)
    ticket.status = "closed"
    await session.commit()
    return await _load_ticket(session, ticket_id)


async def open_queue(session: AsyncSession, assignee_id: int | None = None) -> list[Ticket]:
    stmt = (
        select(Ticket)
        .where(Ticket.status.in_(OPEN_STATUSES))
        .order_by(Ticket.priority, Ticket.id)
        .options(*TICKET_GRAPH)
        .execution_options(populate_existing=True)
    )
    if assignee_id is not None:
        stmt = stmt.where(Ticket.assignee_id == assignee_id)
    return list(await session.scalars(stmt))
