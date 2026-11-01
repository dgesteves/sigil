import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

TOKEN = "s3cret-admin-token"
ADMIN = {"X-Admin-Token": TOKEN}


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(admin_token=TOKEN, environment="test")))
