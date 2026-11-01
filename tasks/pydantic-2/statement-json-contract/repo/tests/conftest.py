from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from statements.models import DiscountLine, Line, Period, Statement

CET = timezone(timedelta(hours=1))


@pytest.fixture
def make_statement():
    def build(**overrides):
        fields = dict(
            statement_id="ST-2026-10-000412",
            account_id="ACC-88213",
            period=Period(start=date(2026, 10, 1), end=date(2026, 10, 31)),
            issued_at=datetime(2026, 11, 1, 7, 0, tzinfo=CET),
            currency="EUR",
            lines=[
                Line(description="Fibre 1 Gbit", quantity=1, unit_price=Decimal("39.95"), cost_center="NET-01"),
                DiscountLine(
                    description="TV bundle",
                    quantity=1,
                    unit_price=Decimal("30.00"),
                    cost_center="TV-02",
                    discount_percent=20,
                    promo_code="AUTUMN26",
                ),
            ],
            notes="Thanks for being with us",
            internal_notes="Paid late twice in 2025",
        )
        fields.update(overrides)
        return Statement(**fields)

    return build
