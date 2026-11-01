import pytest

from flagship.flags import is_enabled


@pytest.fixture(autouse=True)
def one_click_at_25_percent(use_flags):
    use_flags({"one_click": {"enabled": True, "rollout": 25}})


def test_rollout_enables_roughly_the_given_share():
    enabled = sum(is_enabled("one_click", f"user-{i}") for i in range(2000))
    assert 400 <= enabled <= 600


def test_rollout_is_sticky_per_user():
    first = [is_enabled("one_click", f"user-{i}") for i in range(50)]
    again = [is_enabled("one_click", f"user-{i}") for i in range(50)]
    assert first == again
    assert any(first) and not all(first)


def test_rollout_without_a_user_is_off():
    assert not is_enabled("one_click")
