import pytest

from helpdesk import service
from helpdesk.serializers import comment_to_dict, ticket_to_dict

pytestmark = pytest.mark.asyncio


async def test_open_and_fetch(session_factory, agents):
    async with session_factory() as session:
        ticket = await service.open_ticket(session, "Printer on fire", 1, assignee_id=agents["ana"])
        data = ticket_to_dict(ticket)
    assert ticket_to_dict(ticket) == data  # still readable after the session closed
    assert data["subject"] == "Printer on fire"
    assert data["status"] == "open"
    assert data["assignee"] == {"id": agents["ana"], "name": "Ana"}
    assert data["comments"] == []

    async with session_factory() as session:
        again = ticket_to_dict(await service.get_ticket(session, data["id"]))
    assert again == data


async def test_comment_moves_ticket_to_pending(session_factory, agents):
    async with session_factory() as session:
        ticket_id = (await service.open_ticket(session, "VPN drops", 2)).id
        comment = await service.add_comment(session, ticket_id, agents["bo"], "Can you send logs?")
        assert comment_to_dict(comment)["author"] == {"id": agents["bo"], "name": "Bo"}
    async with session_factory() as session:
        data = ticket_to_dict(await service.get_ticket(session, ticket_id))
    assert data["status"] == "pending"
    assert [c["body"] for c in data["comments"]] == ["Can you send logs?"]


async def test_close_keeps_the_result_readable(session_factory, agents):
    async with session_factory() as session:
        ticket_id = (await service.open_ticket(session, "Badge reader", 2)).id
    async with session_factory() as session:
        closed = await service.close_ticket(session, ticket_id)
    data = ticket_to_dict(closed)
    assert data["status"] == "closed"
    assert data["updated_at"] >= data["created_at"]


async def test_queue_order_and_close(session_factory, agents):
    async with session_factory() as session:
        low = (await service.open_ticket(session, "Mouse squeaks", 4)).id
        urgent = (await service.open_ticket(session, "Site down", 1, assignee_id=agents["ana"])).id
        await service.close_ticket(session, low)
        assert [t.id for t in await service.open_queue(session)] == [urgent]


async def test_errors(session_factory):
    async with session_factory() as session:
        with pytest.raises(ValueError):
            await service.open_ticket(session, "Bad", 9)
        with pytest.raises(LookupError):
            await service.close_ticket(session, 404)
