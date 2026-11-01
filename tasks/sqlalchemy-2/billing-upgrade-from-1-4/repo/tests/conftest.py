import sqlite3

import pytest

from billing.db import init_db, make_engine, make_sessionmaker

SEED = """
INSERT INTO customers (id, email, name) VALUES
  (1, 'acme@example.org', 'Acme Ltd'),
  (2, 'globex@example.org', 'Globex'),
  (3, 'initech@example.org', 'Initech');
INSERT INTO invoices (id, number, customer_id, status, issued_on, total_cents) VALUES
  (10, 'INV-0010', 1, 'issued', '2026-08-01', 12000),
  (11, 'INV-0011', 1, 'issued', '2026-10-20', 5000),
  (12, 'INV-0012', 2, 'paid',   '2026-07-15', 9900),
  (13, 'INV-0013', 2, 'issued', '2026-09-01', 4000),
  (14, 'INV-0014', 3, 'void',   '2026-06-30', 7000),
  (15, 'INV-0015', 3, 'issued', '2026-10-01', 2500);
INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_cents) VALUES
  (100, 10, 'Consulting day', 2, 5000),
  (101, 10, 'Travel', 1, 2000),
  (102, 11, 'Support plan', 1, 5000),
  (103, 12, 'Licence', 1, 9900),
  (104, 13, 'Training seat', 2, 2000),
  (105, 15, 'Hosting', 1, 2500);
INSERT INTO payments (id, invoice_id, amount_cents, received_on, method) VALUES
  (1000, 10, 4000, '2026-08-20', 'transfer'),
  (1001, 12, 9900, '2026-07-30', 'card'),
  (1002, 10, 1000, '2026-08-20', 'card'),
  (1003, 13, 4000, '2026-09-10', 'transfer');
"""


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "billing.db"


@pytest.fixture
def engine(db_path):
    engine = make_engine(f"sqlite:///{db_path}")
    init_db(engine)
    with sqlite3.connect(db_path) as raw:
        raw.executescript(SEED)
    raw.close()
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(engine):
    return make_sessionmaker(engine)
