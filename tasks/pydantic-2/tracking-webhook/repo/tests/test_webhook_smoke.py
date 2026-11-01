import pytest

from tracking.webhook import InvalidEvent


def test_invalid_event_lists_fields():
    error = InvalidEvent(["status", "location.countryCode"])
    assert error.fields == ["status", "location.countryCode"]
    with pytest.raises(InvalidEvent):
        raise error
