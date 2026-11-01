from __future__ import annotations

import datetime as dt

from sqlalchemy import ForeignKey, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    email: Mapped[str] = mapped_column(String(254), unique=True)


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject: Mapped[str] = mapped_column(String(200))
    # open -> pending (waiting on the customer) -> open ... -> closed
    status: Mapped[str] = mapped_column(String(16), default="open")
    # 1 = urgent ... 4 = low
    priority: Mapped[int]
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("agents.id"))
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.current_timestamp())
    updated_at: Mapped[dt.datetime] = mapped_column(
        server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    assignee: Mapped[Agent | None] = relationship()
    comments: Mapped[list[Comment]] = relationship(
        back_populates="ticket", order_by="Comment.id"
    )


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    author_id: Mapped[int] = mapped_column(ForeignKey("agents.id"))
    body: Mapped[str]
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.current_timestamp())

    ticket: Mapped[Ticket] = relationship(back_populates="comments")
    author: Mapped[Agent] = relationship()
