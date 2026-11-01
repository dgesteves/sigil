"""Loads flag definitions from the JSON file named by the settings, once."""

import json
from typing import Any

from flagship.settings import get_settings

_definitions: dict[str, dict[str, Any]] | None = None


def definitions() -> dict[str, dict[str, Any]]:
    """Flag name -> {"enabled": bool, "rollout": 0-100, "environments": [...]}.

    The file is read on first use and kept for the life of the process; call reload() to re-read it.
    A missing file means no flags are defined.
    """
    global _definitions
    if _definitions is None:
        path = get_settings().flags_file
        _definitions = json.loads(path.read_text()) if path.exists() else {}
    return _definitions


def reload() -> None:
    global _definitions
    _definitions = None
