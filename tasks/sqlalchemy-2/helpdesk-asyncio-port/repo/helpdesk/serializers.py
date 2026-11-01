"""JSON shapes the API returns. Plain synchronous functions over ORM objects."""

from helpdesk.models import Agent, Comment, Ticket


def agent_to_dict(agent: Agent | None) -> dict | None:
    if agent is None:
        return None
    return {"id": agent.id, "name": agent.name}


def comment_to_dict(comment: Comment) -> dict:
    return {
        "id": comment.id,
        "ticket_id": comment.ticket_id,
        "author": agent_to_dict(comment.author),
        "body": comment.body,
        "created_at": comment.created_at.isoformat(),
    }


def ticket_to_dict(ticket: Ticket) -> dict:
    return {
        "id": ticket.id,
        "subject": ticket.subject,
        "status": ticket.status,
        "priority": ticket.priority,
        "assignee": agent_to_dict(ticket.assignee),
        "created_at": ticket.created_at.isoformat(),
        "updated_at": ticket.updated_at.isoformat(),
        "comments": [comment_to_dict(c) for c in ticket.comments],
    }
