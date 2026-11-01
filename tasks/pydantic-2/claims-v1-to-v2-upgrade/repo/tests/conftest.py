import copy
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from claims.rows import AddressRow, ClaimRow, LineItemRow

BASE_PAYLOAD = {
    "schemaVersion": 2,
    "policyNumber": "HOM-204518",
    "claimType": "home",
    "claimantName": "Noor de Vries",
    "claimantPhone": "+31 6 1234 5678",
    "incidentDate": "2026-10-28",
    "reportedAt": "2026-10-30T09:15:00+00:00",
    "address": {"line1": "Prinsengracht 263", "city": "Amsterdam", "postcode": "1016 GV"},
    "lineItems": [
        {"description": "Water damage to kitchen floor", "amount": "1100.50", "category": "flooring"},
        {"description": "Emergency plumber", "amount": "150", "category": "labour"},
    ],
    "claimedTotal": "1250.50",
    "currency": "eur",
    "tags": ["water"],
    "policeReportNumber": None,
    "adjusterNotes": None,
    "metadata": {"portal": "partner-a"},
}


@pytest.fixture
def make_payload():
    """Build a claim payload as clients send it; pass alias keys to override, or drop=[...] to omit keys."""

    def build(drop=(), **overrides):
        body = copy.deepcopy(BASE_PAYLOAD)
        body.update(overrides)
        for key in drop:
            body.pop(key, None)
        return body

    return build


@pytest.fixture
def as_json():
    return lambda body: json.dumps(body).encode()


@pytest.fixture
def claim_row():
    return ClaimRow(
        policy_number="AUT-771200",
        claim_type="auto",
        claimant_name="Sam Okafor",
        claimant_phone="31612345678",
        incident_date=date(2026, 10, 1),
        reported_at=datetime(2026, 10, 2, 8, 0, tzinfo=timezone.utc),
        address=AddressRow(line1="Coolsingel 40", city="Rotterdam", postcode="3011 AD"),
        line_items=[LineItemRow(description="Rear bumper", amount=Decimal("640.00"), category="bodywork")],
        claimed_total=Decimal("640.00"),
        tags=["collision"],
        response_sla=timedelta(hours=24),
        metadata={"source": "call-centre"},
    )
