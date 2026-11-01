"""Carrier tracking webhook (POST /webhooks/carrier). See docs/carrier-webhook.md."""

from datetime import date, datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
)
from pydantic.alias_generators import to_camel


class InvalidEvent(Exception):
    """Raised for payloads we reject. `fields` lists the offending payload paths, e.g. ["location.countryCode"]."""

    def __init__(self, fields: list[str]):
        super().__init__(f"invalid tracking event: {', '.join(fields) or 'body'}")
        self.fields = fields


class _CarrierModel(BaseModel):
    # The carrier sends camelCase; our code builds events with field names. Unknown keys are ignored.
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, validate_by_alias=True)


class Location(_CarrierModel):
    city: str
    country_code: Annotated[str, Field(min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$"), AfterValidator(str.upper)]


class TrackingEvent(_CarrierModel):
    tracking_number: Annotated[str, AfterValidator(lambda value: value.strip().upper()), Field(min_length=1)]
    status: Literal["label_created", "in_transit", "out_for_delivery", "delivered", "exception"]
    occurred_at: AwareDatetime
    location: Location | None = None
    estimated_delivery: date | None = None
    signed_by: str | None = None
    weight_grams: int | None = Field(None, ge=1)

    @field_validator("occurred_at")
    @classmethod
    def to_utc(cls, value: datetime) -> datetime:
        return value.astimezone(timezone.utc)


def parse_event(body: bytes) -> TrackingEvent:
    try:
        return TrackingEvent.model_validate_json(body)
    except ValidationError as exc:
        raise InvalidEvent(sorted({".".join(str(part) for part in error["loc"]) for error in exc.errors()})) from None


def event_row(event: TrackingEvent) -> dict[str, Any]:
    """Row for the tracking_events table."""
    return {
        "tracking_number": event.tracking_number,
        "status": event.status,
        "occurred_at": event.occurred_at,
        "location_city": event.location.city if event.location else None,
        "location_country": event.location.country_code if event.location else None,
        "estimated_delivery": event.estimated_delivery,
        "signed_by": event.signed_by,
        "weight_grams": event.weight_grams,
    }
