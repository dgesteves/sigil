import os

import pytest

from flagship.settings import get_settings, parse_bool


def test_defaults():
    settings = get_settings()
    assert settings.default_on is False
    assert settings.environment == "production"
    assert settings.flags_file.name == "flags.json"


def test_default_on_from_env():
    os.environ["FLAGSHIP_DEFAULT_ON"] = "yes"
    try:
        get_settings.cache_clear()
        assert get_settings().default_on is True
    finally:
        del os.environ["FLAGSHIP_DEFAULT_ON"]


def test_environment_from_env():
    os.environ["FLAGSHIP_ENV"] = "staging"
    get_settings.cache_clear()
    assert get_settings().environment == "staging"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("1", True), ("YES", True), (" on ", True), ("0", False), ("off", False), ("", False)],
)
def test_parse_bool(raw, expected):
    assert parse_bool(raw) is expected


def test_parse_bool_rejects_garbage():
    with pytest.raises(ValueError):
        parse_bool("maybe")
