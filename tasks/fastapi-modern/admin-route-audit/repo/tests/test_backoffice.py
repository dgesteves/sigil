from conftest import ADMIN


def test_catalog_is_public(client):
    assert client.get("/catalog/products").status_code == 200


def test_users_need_an_admin_token(client):
    assert client.get("/admin/users").status_code == 401
    assert client.get("/admin/users", headers={"X-Admin-Token": "nope"}).status_code == 403
    r = client.get("/admin/users", headers=ADMIN)
    assert r.status_code == 200
    assert [u["id"] for u in r.json()] == [1, 2]


def test_export_status_needs_an_admin_token(client):
    assert client.get("/admin/exports/7").status_code == 401
    assert client.get("/admin/exports/7", headers=ADMIN).json() == {"id": 7, "state": "ready"}
    assert client.get("/admin/exports/9", headers=ADMIN).status_code == 404


def test_reports_need_an_admin_token(client):
    assert client.get("/admin/reports/revenue").status_code == 401
    assert client.get("/admin/reports/revenue", headers=ADMIN).json()["total_cents"] == 1_250_000


def test_whoami(client):
    assert client.get("/admin/me", headers=ADMIN).json() == {"admin": "admin@test"}
