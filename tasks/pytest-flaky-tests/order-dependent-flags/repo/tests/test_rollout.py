import json
import os
import tempfile
from pathlib import Path

from flagship import store
from flagship.flags import is_enabled
from flagship.settings import get_settings

FLAGS_FILE = Path(tempfile.gettempdir()) / "flagship-test-flags.json"


def test_rollout_enables_roughly_the_given_share():
    FLAGS_FILE.write_text(json.dumps({"one_click": {"enabled": True, "rollout": 25}}))
    os.environ["FLAGSHIP_FILE"] = str(FLAGS_FILE)
    get_settings.cache_clear()
    store.reload()
    enabled = sum(is_enabled("one_click", f"user-{i}") for i in range(2000))
    assert 400 <= enabled <= 600


def test_rollout_is_sticky_per_user():
    first = [is_enabled("one_click", f"user-{i}") for i in range(50)]
    again = [is_enabled("one_click", f"user-{i}") for i in range(50)]
    assert first == again
    assert any(first) and not all(first)


def test_rollout_without_a_user_is_off():
    assert not is_enabled("one_click")
