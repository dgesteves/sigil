from flagship.flags import is_enabled


def test_enabled_flag_is_on(use_flags):
    use_flags({"new_checkout": {"enabled": True}})
    assert is_enabled("new_checkout")


def test_disabled_flag_is_off(use_flags):
    use_flags({"new_checkout": {"enabled": False}})
    assert not is_enabled("new_checkout")


def test_unknown_flag_uses_default(use_flags):
    use_flags({})
    assert is_enabled("does_not_exist") is False


def test_flag_limited_to_staging_is_on_in_staging(use_flags):
    use_flags({"search_v2": {"enabled": True, "environments": ["staging"]}}, FLAGSHIP_ENV="staging")
    assert is_enabled("search_v2")


def test_flag_limited_to_staging_is_off_in_production(use_flags):
    use_flags({"search_v2": {"enabled": True, "environments": ["staging"]}}, FLAGSHIP_ENV="production")
    assert not is_enabled("search_v2")
