from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    RootModel,
    field_serializer,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError


def _decimal_as_number(value: Decimal) -> int | float:
    # Pydantic 1 wrote Decimals as JSON numbers (int when whole, float otherwise); clients rely on it.
    return int(value) if value.as_tuple().exponent >= 0 else float(value)


JsonNumberDecimal = Annotated[Decimal, PlainSerializer(_decimal_as_number, when_used="json")]


class ClaimType(str, Enum):
    AUTO = "auto"
    HOME = "home"
    TRAVEL = "travel"


class Address(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True, coerce_numbers_to_str=True)

    line1: str
    city: str
    # Some partner portals send Dutch postcodes and phone numbers as JSON numbers.
    postcode: str
    country: str = "NL"


class LineItem(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)

    description: str = Field(min_length=1, max_length=200)
    amount: JsonNumberDecimal
    category: str | None = None

    @field_validator("amount")
    @classmethod
    def amount_is_positive(cls, value: Decimal) -> Decimal:
        if value <= 0:
            raise PydanticCustomError("amount_not_positive", "line item amounts must be positive")
        return value


class Claim(BaseModel):
    model_config = ConfigDict(
        validate_by_name=True,
        validate_by_alias=True,
        from_attributes=True,
        str_strip_whitespace=True,
        coerce_numbers_to_str=True,
        # The policy-number rule needs a lookahead, which the default Rust regex engine lacks.
        regex_engine="python-re",
    )

    schema_version: Literal[2] = Field(2, alias="schemaVersion")
    # Policy numbers look like ABC-123456. Numbers starting with TST belong to the
    # partner test environment and must never reach production intake.
    policy_number: str = Field(alias="policyNumber", pattern=r"^(?!TST)[A-Z]{3}-\d{6}$")
    claim_type: ClaimType = Field(alias="claimType")
    claimant_name: str = Field(alias="claimantName", min_length=2)
    claimant_phone: str = Field(alias="claimantPhone")
    incident_date: date = Field(alias="incidentDate")
    reported_at: datetime = Field(alias="reportedAt")
    address: Address
    line_items: list[LineItem] = Field(alias="lineItems", min_length=1)
    claimed_total: JsonNumberDecimal = Field(alias="claimedTotal")
    currency: str = Field("eur", validate_default=True)
    tags: list[str] = []
    police_report_number: str | None = Field(None, alias="policeReportNumber")
    adjuster_notes: str | None = Field(None, alias="adjusterNotes")
    response_sla: timedelta = Field(timedelta(hours=48), alias="responseSla")
    metadata: Any = None

    @field_validator("currency")
    @classmethod
    def currency_upper(cls, value: str) -> str:
        return value.upper()

    @field_validator("tags", mode="before")
    @classmethod
    def split_tags(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [part for part in value.split(",") if part.strip()]
        return value

    @field_validator("tags")
    @classmethod
    def normalise_tags(cls, value: list[str]) -> list[str]:
        return [tag.strip().lower() for tag in value]

    @field_validator("claimant_phone")
    @classmethod
    def phone_digits(cls, value: str) -> str:
        digits = value.replace(" ", "").lstrip("+")
        if not digits.isdigit() or not 9 <= len(digits) <= 15:
            raise PydanticCustomError("phone_digits", "phone numbers need 9 to 15 digits")
        return value

    @model_validator(mode="after")
    def totals_and_dates(self) -> "Claim":
        if sum(item.amount for item in self.line_items) != self.claimed_total:
            raise PydanticCustomError("total_mismatch", "claimed total must equal the sum of the line items")
        if self.incident_date > self.reported_at.date():
            raise PydanticCustomError("incident_after_report", "incident date cannot be after the report date")
        return self

    @field_serializer("reported_at", when_used="json")
    def reported_at_isoformat(self, value: datetime) -> str:
        # Pydantic 2 writes UTC as "Z"; the API has always sent "+00:00".
        return value.isoformat()

    @field_serializer("response_sla", when_used="json")
    def sla_seconds(self, value: timedelta) -> float:
        return value.total_seconds()


class ClaimBatch(RootModel[list[Claim]]):
    pass
