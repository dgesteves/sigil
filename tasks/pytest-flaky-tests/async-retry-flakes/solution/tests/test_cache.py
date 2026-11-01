from relaykit.cache import TTLCache


def test_value_is_returned_before_it_expires(fake_time):
    cache = TTLCache(ttl=30, clock=fake_time.monotonic)
    cache.set("signing-key:acme", "k-2026-11")
    fake_time.advance(29.9)
    assert cache.get("signing-key:acme") == "k-2026-11"


def test_value_expires_after_the_ttl(fake_time):
    cache = TTLCache(ttl=30, clock=fake_time.monotonic)
    cache.set("signing-key:acme", "k-2026-11")
    fake_time.advance(30)
    assert cache.get("signing-key:acme") is None


def test_len_counts_only_live_entries(fake_time):
    cache = TTLCache(ttl=30, clock=fake_time.monotonic)
    cache.set("signing-key:acme", "k1")
    fake_time.advance(20)
    cache.set("signing-key:globex", "k2")
    fake_time.advance(15)
    assert len(cache) == 1
    assert cache.get("signing-key:globex") == "k2"
