from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from statements.models import DiscountLine, Line, Period


def test_line_amounts():
    assert Line(description="Router rental", quantity=2, unit_price=Decimal("2.50"), cost_center="NET-02").amount == Decimal("5.00")
    discounted = DiscountLine(
        description="TV bundle", quantity=3, unit_price=Decimal("9.99"), cost_center="TV-02", discount_percent=15
    )
    assert discounted.amount == Decimal("25.47")


def test_subtotal(make_statement):
    assert make_statement().subtotal == Decimal("63.95")


def test_discount_bounds():
    with pytest.raises(ValidationError):
        DiscountLine(description="x", quantity=1, unit_price=Decimal("1.00"), cost_center="c", discount_percent=120)


def test_period_order():
    with pytest.raises(ValidationError):
        Period(start=date(2026, 10, 31), end=date(2026, 10, 1))


def test_statements_keep_their_line_types(make_statement):
    statement = make_statement()
    assert [type(line).__name__ for line in statement.lines] == ["Line", "DiscountLine"]
