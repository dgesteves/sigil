from flagship.flags import is_enabled, override


def test_override_forces_flag_off(use_flags):
    use_flags({"new_checkout": {"enabled": True}})
    override("new_checkout", False)
    assert not is_enabled("new_checkout")


def test_override_forces_unknown_flag_on(use_flags):
    use_flags({})
    override("holiday_banner", True)
    assert is_enabled("holiday_banner")
