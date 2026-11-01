from flagship.flags import is_enabled, override


def test_override_forces_flag_off():
    override("new_checkout", False)
    assert not is_enabled("new_checkout")


def test_override_forces_unknown_flag_on():
    override("holiday_banner", True)
    assert is_enabled("holiday_banner")
