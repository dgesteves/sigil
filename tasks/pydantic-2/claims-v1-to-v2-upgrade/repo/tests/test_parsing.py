import pytest
from pydantic import ValidationError

from claims.api import api_errors, parse_batch, parse_claim, with_changes
from claims.models import Claim


def test_parses_a_valid_claim(make_payload, as_json):
    claim = parse_claim(as_json(make_payload()))
    assert claim.policy_number == "HOM-204518"
    assert claim.claim_type.value == "home"
    assert [str(item.amount) for item in claim.line_items] == ["1100.50", "150"]


def test_names_are_trimmed(make_payload, as_json):
    claim = parse_claim(as_json(make_payload(claimantName="  Noor de Vries  ")))
    assert claim.claimant_name == "Noor de Vries"


def test_police_report_number_may_be_omitted(make_payload, as_json):
    claim = parse_claim(as_json(make_payload(drop=["policeReportNumber"])))
    assert claim.police_report_number is None


def test_currency_is_upper_cased(make_payload, as_json):
    assert parse_claim(as_json(make_payload(currency="usd"))).currency == "USD"


def test_comma_separated_tags(make_payload, as_json):
    claim = parse_claim(as_json(make_payload(tags="Water, Urgent")))
    assert claim.tags == ["water", "urgent"]


def test_numeric_postcode_from_partner_portal(make_payload, as_json):
    body = make_payload(address={"line1": "Damrak 1", "city": "Amsterdam", "postcode": 1012})
    assert parse_claim(as_json(body)).address.postcode == "1012"


def test_test_environment_policies_are_rejected(make_payload, as_json):
    with pytest.raises(ValidationError) as caught:
        parse_claim(as_json(make_payload(policyNumber="TST-000001")))
    assert [problem["field"] for problem in api_errors(caught.value)] == ["policyNumber"]


def test_phone_message_reaches_the_client(make_payload, as_json):
    with pytest.raises(ValidationError) as caught:
        parse_claim(as_json(make_payload(claimantPhone="call me")))
    assert api_errors(caught.value) == [
        {"field": "claimantPhone", "message": "phone numbers need 9 to 15 digits"}
    ]


def test_totals_must_add_up(make_payload, as_json):
    with pytest.raises(ValidationError) as caught:
        parse_claim(as_json(make_payload(claimedTotal="1300.00")))
    assert api_errors(caught.value) == [
        {"field": None, "message": "claimed total must equal the sum of the line items"}
    ]


def test_batch(make_payload, as_json):
    claims = parse_batch(as_json([make_payload(), make_payload(policyNumber="TRV-000777", claimType="travel")]))
    assert [claim.policy_number for claim in claims] == ["HOM-204518", "TRV-000777"]
    assert all(isinstance(claim, Claim) for claim in claims)


def test_adjuster_edits_use_field_names(make_payload, as_json):
    claim = parse_claim(as_json(make_payload()))
    edited = with_changes(claim, adjuster_notes="  Photos received  ")
    assert edited.adjuster_notes == "Photos received"
    assert edited.policy_number == claim.policy_number
