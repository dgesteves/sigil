import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from statements.models import DiscountLine, Line, Period, Statement
from statements.render import render_statement, statement_payload


def document(statement):
    return json.loads(render_statement(statement))


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def test_example_from_the_contract(make_statement):
    assert document(make_statement()) == {
        "statementId": "ST-2026-10-000412",
        "accountId": "ACC-88213",
        "period": {"start": "2026-10-01", "end": "2026-10-31"},
        "issuedAt": "2026-11-01T06:00:00Z",
        "currency": "EUR",
        "lines": [
            {"kind": "charge", "description": "Fibre 1 Gbit", "quantity": 1, "unitPrice": 39.95, "amount": 39.95},
            {
                "kind": "discount",
                "description": "TV bundle",
                "quantity": 1,
                "unitPrice": 30.0,
                "amount": 24.0,
                "discountPercent": 20,
                "promoCode": "AUTUMN26",
            },
        ],
        "subtotal": 63.95,
        "dueInDays": 14,
        "notes": "Thanks for being with us",
    }


def test_money_is_always_a_number(make_statement):
    lines = [
        Line(description="Router rental", quantity=2, unit_price=Decimal("2.50"), cost_center="NET-02"),
        Line(description="Late fee", quantity=1, unit_price=Decimal("0.50"), cost_center="FIN-09"),
        DiscountLine(description="Sports", quantity=3, unit_price=Decimal("9.99"), cost_center="TV-03", discount_percent=15),
    ]
    body = document(make_statement(lines=lines))
    for line in body["lines"]:
        assert is_number(line["unitPrice"]) and is_number(line["amount"]), line
    assert [line["amount"] for line in body["lines"]] == [5, 0.5, 25.47]
    assert [line["unitPrice"] for line in body["lines"]] == [2.5, 0.5, 9.99]
    assert is_number(body["subtotal"]) and body["subtotal"] == 30.97


def test_discount_lines_keep_their_fields(make_statement):
    lines = [
        DiscountLine(description="Loyalty", quantity=1, unit_price=Decimal("10.00"), cost_center="CRM-1", discount_percent=0),
        DiscountLine(description="Welcome", quantity=2, unit_price=Decimal("5.00"), cost_center="CRM-2", discount_percent=50),
    ]
    body = document(make_statement(lines=lines))
    assert [line["kind"] for line in body["lines"]] == ["discount", "discount"]
    assert body["lines"][0]["discountPercent"] == 0
    assert body["lines"][1]["discountPercent"] == 50
    assert body["lines"][1]["amount"] == 5
    for line in body["lines"]:
        assert "promoCode" not in line


def test_issued_at_is_utc(make_statement):
    plus_two = timezone(timedelta(hours=2))
    assert document(make_statement(issued_at=datetime(2026, 7, 1, 1, 30, tzinfo=plus_two)))["issuedAt"] == "2026-06-30T23:30:00Z"
    assert document(make_statement(issued_at=datetime(2026, 7, 1, 1, 30, tzinfo=timezone.utc)))["issuedAt"] == "2026-07-01T01:30:00Z"
    minus_five = timezone(timedelta(hours=-5))
    assert document(make_statement(issued_at=datetime(2026, 12, 31, 20, 0, tzinfo=minus_five)))["issuedAt"] == "2027-01-01T01:00:00Z"


def test_due_in_days(make_statement):
    assert document(make_statement(payment_terms=timedelta(days=30)))["dueInDays"] == 30
    body = document(make_statement(payment_terms=timedelta(days=7)))
    assert body["dueInDays"] == 7 and isinstance(body["dueInDays"], int)


def test_no_internal_fields_and_no_nulls(make_statement):
    body = document(make_statement(notes=None))
    text = json.dumps(body)
    assert "notes" not in body
    assert "internal" not in text.lower() and "Paid late" not in text
    assert "NET-01" not in text and "TV-02" not in text and "cost" not in text.lower()
    assert "null" not in text
    assert all("_" not in key for key in body)
    assert all("_" not in key for line in body["lines"] for key in line)


def test_empty_statement(make_statement):
    body = document(make_statement(lines=[], notes=None))
    assert body["lines"] == []
    assert body["subtotal"] == 0


def test_payload_is_the_same_document_as_plain_json(make_statement):
    statement = make_statement()
    payload = statement_payload(statement)
    assert json.loads(json.dumps(payload)) == document(statement)


def test_statements_are_still_built_with_field_names():
    statement = Statement(
        statement_id="ST-1",
        account_id="ACC-1",
        period=Period(start=date(2026, 9, 1), end=date(2026, 9, 30)),
        issued_at=datetime(2026, 10, 1, 6, 0, tzinfo=timezone.utc),
        currency="EUR",
        lines=[Line(description="Fibre", quantity=1, unit_price=Decimal("39.95"), cost_center="NET-01")],
    )
    assert statement.subtotal == Decimal("39.95")
    assert document(statement)["statementId"] == "ST-1"


def test_rendering_does_not_mutate_the_statement(make_statement):
    statement = make_statement()
    render_statement(statement)
    statement_payload(statement)
    assert statement.issued_at.utcoffset() == timedelta(hours=1)
    assert isinstance(statement.lines[1], DiscountLine)
    assert statement.internal_notes == "Paid late twice in 2025"


@pytest.mark.parametrize("bad", ["eur", "EURO"])
def test_currency_rule_still_applies(make_statement, bad):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        make_statement(currency=bad)
