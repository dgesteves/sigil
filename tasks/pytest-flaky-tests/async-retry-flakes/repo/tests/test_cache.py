import time

from relaykit.cache import TTLCache


def test_value_is_returned_before_it_expires():
    cache = TTLCache(ttl=0.05)
    cache.set("signing-key:acme", "k-2026-11")
    time.sleep(0.01)
    assert cache.get("signing-key:acme") == "k-2026-11"


def test_value_expires_after_the_ttl():
    cache = TTLCache(ttl=0.05)
    cache.set("signing-key:acme", "k-2026-11")
    time.sleep(0.06)
    assert cache.get("signing-key:acme") is None


def test_len_counts_only_live_entries():
    cache = TTLCache(ttl=0.05)
    cache.set("signing-key:acme", "k1")
    time.sleep(0.03)
    cache.set("signing-key:globex", "k2")
    time.sleep(0.03)
    assert len(cache) == 1
