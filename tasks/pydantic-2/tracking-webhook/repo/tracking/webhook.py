"""Carrier tracking webhook (POST /webhooks/carrier). See docs/carrier-webhook.md."""

from typing import Any


class InvalidEvent(Exception):
    """Raised for payloads we reject. `fields` lists the offending payload paths, e.g. ["location.countryCode"]."""

    def __init__(self, fields: list[str]):
        super().__init__(f"invalid tracking event: {', '.join(fields) or 'body'}")
        self.fields = fields


class TrackingEvent:
    """TODO: replace with a validated model (pydantic is already a dependency)."""


def parse_event(body: bytes) -> TrackingEvent:
    raise NotImplementedError


def event_row(event: TrackingEvent) -> dict[str, Any]:
    """Row for the tracking_events table."""
    raise NotImplementedError
