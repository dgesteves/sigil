from datetime import date, datetime, timedelta
from decimal import Decimal

from pydantic import AwareDatetime, BaseModel, Field, model_validator

CENT = Decimal("0.01")


class Period(BaseModel):
    start: date
    end: date

    @model_validator(mode="after")
    def ordered(self) -> "Period":
        if self.end < self.start:
            raise ValueError("period end is before its start")
        return self


class Line(BaseModel):
    description: str = Field(min_length=1)
    quantity: int = Field(ge=0)
    unit_price: Decimal = Field(ge=0, decimal_places=2)
    # Finance's internal allocation code. Customers must never see it.
    cost_center: str

    @property
    def amount(self) -> Decimal:
        return (self.quantity * self.unit_price).quantize(CENT)


class DiscountLine(Line):
    discount_percent: int = Field(ge=0, le=100)
    promo_code: str | None = None

    @property
    def amount(self) -> Decimal:
        gross = self.quantity * self.unit_price
        return (gross * (100 - self.discount_percent) / 100).quantize(CENT)


class Statement(BaseModel):
    statement_id: str
    account_id: str
    period: Period
    issued_at: AwareDatetime
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    lines: list[Line]
    payment_terms: timedelta = timedelta(days=14)
    notes: str | None = None
    # Notes from the collections team. Internal only.
    internal_notes: str | None = None

    @property
    def subtotal(self) -> Decimal:
        return sum((line.amount for line in self.lines), Decimal("0.00"))
