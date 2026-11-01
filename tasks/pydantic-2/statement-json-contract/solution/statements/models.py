from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    AliasGenerator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    computed_field,
    field_serializer,
    model_validator,
)
from pydantic.alias_generators import to_camel

CENT = Decimal("0.01")

# Money leaves the API as a JSON number. Pydantic writes Decimal as a string in JSON by default.
Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


class ApiModel(BaseModel):
    # camelCase on the way out only: the service still builds models with field names.
    model_config = ConfigDict(
        alias_generator=AliasGenerator(serialization_alias=to_camel),
        serialize_by_alias=True,
    )


class Period(ApiModel):
    start: date
    end: date

    @model_validator(mode="after")
    def ordered(self) -> "Period":
        if self.end < self.start:
            raise ValueError("period end is before its start")
        return self


class Line(ApiModel):
    # Serialize lines by their runtime class, so DiscountLine keeps its own fields inside list[Line].
    model_config = ConfigDict(polymorphic_serialization=True)

    description: str = Field(min_length=1)
    quantity: int = Field(ge=0)
    unit_price: Money = Field(ge=0, decimal_places=2)
    # Finance's internal allocation code. Customers must never see it.
    cost_center: str = Field(exclude=True)

    @computed_field
    @property
    def kind(self) -> Literal["charge", "discount"]:
        return "charge"

    @computed_field
    @property
    def amount(self) -> Money:
        return (self.quantity * self.unit_price).quantize(CENT)


class DiscountLine(Line):
    discount_percent: int = Field(ge=0, le=100)
    promo_code: str | None = None

    @computed_field
    @property
    def kind(self) -> Literal["charge", "discount"]:
        return "discount"

    @computed_field
    @property
    def amount(self) -> Money:
        gross = self.quantity * self.unit_price
        return (gross * (100 - self.discount_percent) / 100).quantize(CENT)


class Statement(ApiModel):
    statement_id: str
    account_id: str
    period: Period
    issued_at: AwareDatetime
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    lines: list[Line]
    payment_terms: timedelta = Field(timedelta(days=14), serialization_alias="dueInDays")
    notes: str | None = None
    # Notes from the collections team. Internal only.
    internal_notes: str | None = Field(None, exclude=True)

    @computed_field
    @property
    def subtotal(self) -> Money:
        return sum((line.amount for line in self.lines), Decimal("0.00"))

    @field_serializer("issued_at", when_used="json")
    def issued_at_utc(self, value: datetime) -> str:
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    @field_serializer("payment_terms", when_used="json")
    def due_in_days(self, value: timedelta) -> int:
        return value.days
