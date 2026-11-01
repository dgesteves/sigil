# The upgrade must be a real port to the Pydantic 2 API, not the bundled v1 copy.
import pathlib

import pydantic

from claims import models


def test_models_are_pydantic_2_models():
    assert pydantic.VERSION == "2.14.2"
    for name in ("Address", "LineItem", "Claim"):
        assert issubclass(getattr(models, name), pydantic.BaseModel), name
    assert issubclass(models.ClaimBatch, pydantic.RootModel)


def test_no_v1_compatibility_imports():
    for path in pathlib.Path("claims").glob("*.py"):
        assert "pydantic.v1" not in path.read_text(), path
