import json
from datetime import date, datetime, timedelta, timezone

import pytest

from tracking.webhook import InvalidEvent, TrackingEvent, event_row, parse_event

FULL = {
    "trackingNumber": " ns4471209nl ",
    "status": "in_transit",
    "occurredAt": "2026-10-31T14:05:12+01:00",
    "location": {"city": "Utrecht", "countryCode": "nl"},
    "estimatedDelivery": "2026-11-02",
    "weightGrams": 1250,
    "carrierRef": "e1f3-77",
}


def body(**changes):
    payload = {**FULL, **changes}
    return json.dumps({k: v for k, v in payload.items() if v is not ...}).encode()


def rejected(raw):
    with pytest.raises(InvalidEvent) as caught:
        parse_event(raw)
    return sorted(caught.value.fields)


def test_full_event():
    row = event_row(parse_event(body()))
    assert row == {
        "tracking_number": "NS4471209NL",
        "status": "in_transit",
        "occurred_at": datetime(2026, 10, 31, 13, 5, 12, tzinfo=timezone.utc),
        "location_city": "Utrecht",
        "location_country": "NL",
        "estimated_delivery": date(2026, 11, 2),
        "signed_by": None,
        "weight_grams": 1250,
    }
    assert row["occurred_at"].utcoffset() == timedelta(0)


def test_minimal_event_omits_optional_keys():
    raw = body(location=..., estimatedDelivery=..., weightGrams=..., carrierRef=...)
    row = event_row(parse_event(raw))
    assert row["location_city"] is None and row["location_country"] is None
    assert row["estimated_delivery"] is None and row["signed_by"] is None and row["weight_grams"] is None


def test_optional_keys_may_be_null():
    raw = body(location=None, estimatedDelivery=None, weightGrams=None, signedBy=None)
    row = event_row(parse_event(raw))
    assert (row["location_city"], row["estimated_delivery"], row["weight_grams"], row["signed_by"]) == (None, None, None, None)


def test_delivered_with_signature():
    row = event_row(parse_event(body(status="delivered", signedBy="J. Bakker")))
    assert (row["status"], row["signed_by"]) == ("delivered", "J. Bakker")


def test_weight_as_string():
    assert event_row(parse_event(body(weightGrams="980")))["weight_grams"] == 980


@pytest.mark.parametrize("weight", [12.5, "12.5", 0, -3, "heavy"])
def test_bad_weights(weight):
    assert rejected(body(weightGrams=weight)) == ["weightGrams"]


def test_whole_float_weight_is_fine():
    assert event_row(parse_event(body(weightGrams=1250.0)))["weight_grams"] == 1250


def test_timestamp_needs_an_offset():
    assert rejected(body(occurredAt="2026-10-31T14:05:12")) == ["occurredAt"]


def test_utc_timestamps():
    row = event_row(parse_event(body(occurredAt="2026-10-31T23:30:00-05:00")))
    assert row["occurred_at"] == datetime(2026, 11, 1, 4, 30, tzinfo=timezone.utc)
    assert row["occurred_at"].utcoffset() == timedelta(0)


@pytest.mark.parametrize("status", ["lost", "IN_TRANSIT", ""])
def test_unknown_status(status):
    assert rejected(body(status=status)) == ["status"]


def test_required_keys():
    raw = json.dumps({"carrierRef": "x"}).encode()
    assert rejected(raw) == ["occurredAt", "status", "trackingNumber"]


def test_location_rules():
    assert rejected(body(location={"city": "Utrecht", "countryCode": "NLD"})) == ["location.countryCode"]
    assert rejected(body(location={"countryCode": "NL"})) == ["location.city"]


def test_several_problems_at_once():
    assert rejected(body(status="lost", weightGrams=1.5, location={"city": "Gent", "countryCode": "b"})) == [
        "location.countryCode",
        "status",
        "weightGrams",
    ]


@pytest.mark.parametrize("raw", [b"not json", b"[]", b"null"])
def test_not_an_event(raw):
    with pytest.raises(InvalidEvent):
        parse_event(raw)


def test_events_built_in_code_with_field_names():
    event = TrackingEvent(
        tracking_number="ns1",
        status="label_created",
        occurred_at=datetime(2026, 10, 30, 8, 0, tzinfo=timezone(timedelta(hours=2))),
    )
    row = event_row(event)
    assert row["tracking_number"] == "NS1"
    assert row["occurred_at"] == datetime(2026, 10, 30, 6, 0, tzinfo=timezone.utc)
    assert row["location_city"] is None and row["weight_grams"] is None


def test_country_code_upper_cased_in_code_too():
    event = TrackingEvent(
        tracking_number="NS2",
        status="exception",
        occurred_at=datetime(2026, 10, 30, 8, 0, tzinfo=timezone.utc),
        location={"city": "Antwerpen", "country_code": "be"},
    )
    assert event_row(event)["location_country"] == "BE"
