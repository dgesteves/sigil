"""Settings read from the environment once per process."""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off", ""}


@dataclass(frozen=True)
class Settings:
    flags_file: Path
    default_on: bool
    environment: str


def parse_bool(raw: str) -> bool:
    value = raw
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ValueError(f"not a boolean: {raw!r}")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Read FLAGSHIP_* variables. Cached: call get_settings.cache_clear() after changing them."""
    return Settings(
        flags_file=Path(os.environ.get("FLAGSHIP_FILE", "flags.json")),
        default_on=parse_bool(os.environ.get("FLAGSHIP_DEFAULT_ON", "false")),
        environment=os.environ.get("FLAGSHIP_ENV", "production"),
    )
