import pytest

from helpdesk import service
from helpdesk.serializers import comment_to_dict, ticket_to_dict


def test_open_and_fetch(session_factory, agents):
    with session_factory() as session:
        ticket = service.open_ticket(session, "Printer on fire", 1, assignee_id=agents["ana"])
        data = ticket_to_dict(ticket)
    assert data["subject"] == "Printer on fire"
    assert data["status"] == "open"
    assert data["assignee"] == {"id": agents["ana"], "name": "Ana"}
    assert data["comments"] == []

    with session_factory() as session:
        again = ticket_to_dict(service.get_ticket(session, data["id"]))
    assert again == data


def test_comment_moves_ticket_to_pending(session_factory, agents):
    with session_factory() as session:
        ticket_id = service.open_ticket(session, "VPN drops", 2).id
        comment = service.add_comment(session, ticket_id, agents["bo"], "Can you send logs?")
        assert comment_to_dict(comment)["author"] == {"id": agents["bo"], "name": "Bo"}
    with session_factory() as session:
        data = ticket_to_dict(service.get_ticket(session, ticket_id))
    assert data["status"] == "pending"
    assert [c["body"] for c in data["comments"]] == ["Can you send logs?"]


def test_queue_order_and_close(session_factory, agents):
    with session_factory() as session:
        low = service.open_ticket(session, "Mouse squeaks", 4).id
        urgent = service.open_ticket(session, "Site down", 1, assignee_id=agents["ana"]).id
        service.close_ticket(session, low)
        assert [t.id for t in service.open_queue(session)] == [urgent]


def test_errors(session_factory):
    with session_factory() as session:
        with pytest.raises(ValueError):
            service.open_ticket(session, "Bad", 9)
        with pytest.raises(LookupError):
            service.close_ticket(session, 404)
