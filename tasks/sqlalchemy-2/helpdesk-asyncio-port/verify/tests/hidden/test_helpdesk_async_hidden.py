# Hidden checks for the asyncio port. Plain sync tests driving asyncio.run, so they do not depend on
# how the port configures pytest-asyncio.
import asyncio
import datetime as dt
import inspect

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from helpdesk import service
from helpdesk.db import init_db, make_engine, make_sessionmaker
from helpdesk.models import Agent
from helpdesk.serializers import comment_to_dict, ticket_to_dict

FUNCTIONS = ("open_ticket", "get_ticket", "assign", "add_comment", "close_ticket", "open_queue")


def run(tmp_path, scenario):
    async def main():
        engine = make_engine(f"sqlite+aiosqlite:///{tmp_path / 'hd.db'}")
        assert isinstance(engine, AsyncEngine)
        try:
            await init_db(engine)
            factory = make_sessionmaker(engine)
            async with factory() as session:
                ana = Agent(name="Ana", email="ana@example.org")
                bo = Agent(name="Bo", email="bo@example.org")
                cy = Agent(name="Cy", email="cy@example.org")
                session.add_all([ana, bo, cy])
                await session.commit()
                ids = {"ana": ana.id, "bo": bo.id, "cy": cy.id}
            return await scenario(factory, ids)
        finally:
            await engine.dispose()

    return asyncio.run(main())


def parse(ts: str) -> dt.datetime:
    return dt.datetime.fromisoformat(ts)


def test_public_api_is_async(tmp_path):
    for name in FUNCTIONS:
        assert inspect.iscoroutinefunction(getattr(service, name)), name

    async def scenario(factory, ids):
        assert isinstance(factory, async_sessionmaker)

    run(tmp_path, scenario)


def test_open_ticket_result_is_serializable_inside_and_after_the_session(tmp_path):
    async def scenario(factory, ids):
        async with factory() as session:
            assigned = await service.open_ticket(session, "Printer on fire", 1, assignee_id=ids["ana"])
            unassigned = await service.open_ticket(session, "Mouse squeaks", 4)
            inside = ticket_to_dict(assigned)
        after = ticket_to_dict(assigned)
        return inside, after, ticket_to_dict(unassigned)

    inside, after, unassigned = run(tmp_path, scenario)
    assert inside == after
    assert after["subject"] == "Printer on fire"
    assert after["status"] == "open"
    assert after["priority"] == 1
    assert after["assignee"]["name"] == "Ana"
    assert after["comments"] == []
    assert parse(after["updated_at"]) >= parse(after["created_at"])
    assert unassigned["assignee"] is None and unassigned["status"] == "open"


def test_assign_returns_the_new_assignee(tmp_path):
    async def scenario(factory, ids):
        async with factory() as session:
            ticket = await service.open_ticket(session, "VPN drops", 2, assignee_id=ids["ana"])
        async with factory() as session:
            reassigned = await service.assign(session, ticket.id, ids["bo"])
            inside = ticket_to_dict(reassigned)
        return inside, ticket_to_dict(reassigned)

    inside, after = run(tmp_path, scenario)
    assert inside == after
    assert after["assignee"]["name"] == "Bo"
    assert parse(after["updated_at"]) >= parse(after["created_at"])


def test_comments_carry_their_author(tmp_path):
    async def scenario(factory, ids):
        async with factory() as session:
            ticket = await service.open_ticket(session, "Laptop slow", 3, assignee_id=ids["ana"])
        async with factory() as session:
            first = await service.add_comment(session, ticket.id, ids["bo"], "Have you tried turning it off?")
            first_inside = comment_to_dict(first)
        async with factory() as session:
            second = await service.add_comment(session, ticket.id, ids["cy"], "Sending a replacement.")
        async with factory() as session:
            fetched = await service.get_ticket(session, ticket.id)
        return first_inside, comment_to_dict(first), comment_to_dict(second), ticket_to_dict(fetched)

    first_inside, first, second, data = run(tmp_path, scenario)
    assert first_inside == first
    assert first["author"]["name"] == "Bo"
    assert second["author"]["name"] == "Cy"
    assert data["status"] == "pending"
    assert data["assignee"]["name"] == "Ana"
    assert [(c["author"]["name"], c["body"]) for c in data["comments"]] == [
        ("Bo", "Have you tried turning it off?"),
        ("Cy", "Sending a replacement."),
    ]


def test_close_ticket_result_is_complete(tmp_path):
    async def scenario(factory, ids):
        async with factory() as session:
            ticket = await service.open_ticket(session, "Badge reader", 2, assignee_id=ids["cy"])
            await service.add_comment(session, ticket.id, ids["cy"], "On my way.")
        async with factory() as session:
            closed = await service.close_ticket(session, ticket.id)
            inside = ticket_to_dict(closed)
        async with factory() as session:
            stored = ticket_to_dict(await service.get_ticket(session, ticket.id))
        return inside, ticket_to_dict(closed), stored

    inside, after, stored = run(tmp_path, scenario)
    assert inside == after
    assert after["status"] == "closed" and stored["status"] == "closed"
    assert after["assignee"]["name"] == "Cy"
    assert [c["author"]["name"] for c in after["comments"]] == ["Cy"]
    assert parse(after["updated_at"]) >= parse(after["created_at"])
    assert after["updated_at"] == stored["updated_at"]


def test_open_queue_is_fully_loaded_and_ordered(tmp_path):
    async def scenario(factory, ids):
        async with factory() as session:
            t_low = await service.open_ticket(session, "Desk wobbles", 4, assignee_id=ids["ana"])
            t_urgent = await service.open_ticket(session, "Site down", 1, assignee_id=ids["bo"])
            t_mid = await service.open_ticket(session, "Wifi in room 3", 2)
            t_done = await service.open_ticket(session, "Old request", 1, assignee_id=ids["ana"])
            t_urgent2 = await service.open_ticket(session, "Payments failing", 1, assignee_id=ids["ana"])
        async with factory() as session:
            await service.add_comment(session, t_urgent.id, ids["cy"], "Paging on-call.")
            await service.add_comment(session, t_urgent.id, ids["bo"], "Rolled back.")
            await service.add_comment(session, t_low.id, ids["ana"], "Ordered a new desk.")
            await service.close_ticket(session, t_done.id)
        async with factory() as session:
            everyone = await service.open_queue(session)
            inside = [ticket_to_dict(t) for t in everyone]
        async with factory() as session:
            mine = await service.open_queue(session, assignee_id=ids["ana"])
        ordered = [t_urgent.id, t_urgent2.id, t_mid.id, t_low.id]
        return ordered, t_urgent2.id, t_low.id, inside, [ticket_to_dict(t) for t in everyone], [ticket_to_dict(t) for t in mine]

    ordered, urgent2, low, inside, everyone, mine = run(tmp_path, scenario)
    assert inside == everyone
    assert [t["id"] for t in everyone] == ordered
    by_id = {t["id"]: t for t in everyone}
    assert [(c["author"]["name"], c["body"]) for c in by_id[ordered[0]]["comments"]] == [
        ("Cy", "Paging on-call."),
        ("Bo", "Rolled back."),
    ]
    assert by_id[ordered[0]]["assignee"]["name"] == "Bo"
    assert by_id[ordered[2]]["assignee"] is None
    assert [t["id"] for t in mine] == [urgent2, low]
    assert all(t["assignee"]["name"] == "Ana" for t in mine)


def test_errors_are_unchanged(tmp_path):
    async def scenario(factory, ids):
        async with factory() as session:
            with pytest.raises(ValueError):
                await service.open_ticket(session, "Bad priority", 7)
            assert await service.get_ticket(session, 404) is None
            with pytest.raises(LookupError):
                await service.assign(session, 404, ids["ana"])
            with pytest.raises(LookupError):
                await service.close_ticket(session, 404)
            with pytest.raises(LookupError):
                await service.add_comment(session, 404, ids["ana"], "hello?")
        async with factory() as session:
            ticket = await service.open_ticket(session, "Done", 3)
            await service.close_ticket(session, ticket.id)
            with pytest.raises(ValueError):
                await service.add_comment(session, ticket.id, ids["ana"], "too late")

    run(tmp_path, scenario)


def test_foreign_keys_are_still_enforced(tmp_path):
    async def scenario(factory, ids):
        async with factory() as session:
            ticket = await service.open_ticket(session, "Who are you?", 3)
        async with factory() as session:
            with pytest.raises(IntegrityError):
                await service.add_comment(session, ticket.id, 9999, "ghost comment")
        async with factory() as session:
            with pytest.raises(IntegrityError):
                await service.open_ticket(session, "Ghost assignee", 3, assignee_id=9999)

    run(tmp_path, scenario)
