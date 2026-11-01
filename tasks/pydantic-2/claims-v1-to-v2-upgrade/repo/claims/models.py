from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, Field, constr, root_validator, validator


class ClaimType(str, Enum):
    AUTO = "auto"
    HOME = "home"
    TRAVEL = "travel"


class Address(BaseModel):
    line1: str
    city: str
    # Some partner portals send Dutch postcodes and phone numbers as JSON numbers.
    postcode: str
    country: str = "NL"

    class Config:
        orm_mode = True
        anystr_strip_whitespace = True


class LineItem(BaseModel):
    description: constr(min_length=1, max_length=200)
    amount: Decimal
    category: Optional[str]

    class Config:
        orm_mode = True
        anystr_strip_whitespace = True

    @validator("amount")
    def amount_is_positive(cls, value):
        if value <= 0:
            raise ValueError("line item amounts must be positive")
        return value


class Claim(BaseModel):
    schema_version: int = Field(2, const=True, alias="schemaVersion")
    # Policy numbers look like ABC-123456. Numbers starting with TST belong to the
    # partner test environment and must never reach production intake.
    policy_number: str = Field(..., alias="policyNumber", regex=r"^(?!TST)[A-Z]{3}-\d{6}$")
    claim_type: ClaimType = Field(..., alias="claimType")
    claimant_name: str = Field(..., alias="claimantName", min_length=2)
    claimant_phone: str = Field(..., alias="claimantPhone")
    incident_date: date = Field(..., alias="incidentDate")
    reported_at: datetime = Field(..., alias="reportedAt")
    address: Address
    line_items: List[LineItem] = Field(..., alias="lineItems", min_items=1)
    claimed_total: Decimal = Field(..., alias="claimedTotal")
    currency: str = "eur"
    tags: List[str] = []
    police_report_number: Optional[str] = Field(alias="policeReportNumber")
    adjuster_notes: Optional[str] = Field(alias="adjusterNotes")
    response_sla: timedelta = Field(timedelta(hours=48), alias="responseSla")
    metadata: Any

    class Config:
        allow_population_by_field_name = True
        orm_mode = True
        anystr_strip_whitespace = True

    @validator("currency", always=True)
    def currency_upper(cls, value):
        return value.upper()

    @validator("tags", pre=True)
    def split_tags(cls, value):
        if isinstance(value, str):
            return [part for part in value.split(",") if part.strip()]
        return value

    @validator("tags", each_item=True)
    def normalise_tag(cls, value):
        return value.strip().lower()

    @validator("claimant_phone")
    def phone_digits(cls, value):
        digits = value.replace(" ", "").lstrip("+")
        if not digits.isdigit() or not 9 <= len(digits) <= 15:
            raise ValueError("phone numbers need 9 to 15 digits")
        return value

    @root_validator(skip_on_failure=True)
    def totals_and_dates(cls, values):
        items_total = sum(item.amount for item in values["line_items"])
        if items_total != values["claimed_total"]:
            raise ValueError("claimed total must equal the sum of the line items")
        if values["incident_date"] > values["reported_at"].date():
            raise ValueError("incident date cannot be after the report date")
        return values


class ClaimBatch(BaseModel):
    __root__: List[Claim]
