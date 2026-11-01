import json
import os
import tempfile
from pathlib import Path

from flagship import store
from flagship.flags import is_enabled
from flagship.settings import get_settings

FLAGS_FILE = Path(tempfile.gettempdir()) / "flagship-test-flags.json"


def use_flags(definitions):
    FLAGS_FILE.write_text(json.dumps(definitions))
    os.environ["FLAGSHIP_FILE"] = str(FLAGS_FILE)
    get_settings.cache_clear()
    store.reload()


def test_enabled_flag_is_on():
    use_flags({"new_checkout": {"enabled": True}})
    assert is_enabled("new_checkout")


def test_disabled_flag_is_off():
    use_flags({"new_checkout": {"enabled": False}})
    assert not is_enabled("new_checkout")


def test_unknown_flag_uses_default():
    assert is_enabled("does_not_exist") is False


def test_flag_limited_to_staging_is_on_in_staging():
    use_flags({"search_v2": {"enabled": True, "environments": ["staging"]}})
    assert is_enabled("search_v2")


def test_flag_limited_to_staging_is_off_in_production():
    os.environ["FLAGSHIP_ENV"] = "production"
    use_flags({"search_v2": {"enabled": True, "environments": ["staging"]}})
    assert not is_enabled("search_v2")
