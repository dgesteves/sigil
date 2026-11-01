# Behaviour the claims API had on Pydantic 1.10 that the upgrade must keep. Every test here passes
# against the original code on pydantic 1.10.26. Default message wording changed between majors, so
# only custom messages, fields and values are pinned.
import json
from datetime import timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from claims.api import (
    api_errors,
    batch_json,
    claim_document,
    claim_from_row,
    claim_json,
    parse_batch,
    parse_claim,
    with_changes,
)
from claims.models import Claim


def problems(body, as_json):
    with pytest.raises(ValidationError) as caught:
        parse_claim(as_json(body))
    return api_errors(caught.value)


# --- optional fields stay optional -------------------------------------------------------------


def test_minimal_claim_without_optional_keys(make_payload, as_json):
    body = make_payload(drop=["policeReportNumber", "adjusterNotes", "metadata", "tags", "currency"])
    for item in body["lineItems"]:
        item.pop("category")
    claim = parse_claim(as_json(body))
    assert claim.police_report_number is None
    assert claim.adjuster_notes is None
    assert claim.metadata is None
    assert claim.tags == []
    assert [item.category for item in claim.line_items] == [None, None]


def test_defaults(make_payload, as_json):
    claim = parse_claim(as_json(make_payload(drop=["currency", "schemaVersion"])))
    assert claim.currency == "EUR"
    assert claim.schema_version == 2
    assert claim.response_sla == timedelta(hours=48)
    assert claim.address.country == "NL"


# --- validation rules ---------------------------------------------------------------------------


@pytest.mark.parametrize("policy", ["TST-123456", "hom-204518", "HOM-20451", "HOME-204518", "HOM_204518"])
def test_policy_number_rules(make_payload, as_json, policy):
    assert [p["field"] for p in problems(make_payload(policyNumber=policy), as_json)] == ["policyNumber"]


@pytest.mark.parametrize("policy", ["TSX-123456", "ATS-000001", "AUT-999999"])
def test_policy_numbers_that_merely_contain_tst_letters(make_payload, as_json, policy):
    assert parse_claim(as_json(make_payload(policyNumber=policy))).policy_number == policy


def test_schema_version_is_fixed(make_payload, as_json):
    assert [p["field"] for p in problems(make_payload(schemaVersion=3), as_json)] == ["schemaVersion"]


def test_at_least_one_line_item(make_payload, as_json):
    body = make_payload(lineItems=[], claimedTotal="0")
    assert [p["field"] for p in problems(body, as_json)] == ["lineItems"]


def test_numeric_phone_from_partner_portal(make_payload, as_json):
    claim = parse_claim(as_json(make_payload(claimantPhone=31612345678)))
    assert claim.claimant_phone == "31612345678"


def test_whitespace_is_trimmed_everywhere(make_payload, as_json):
    body = make_payload(
        address={"line1": " Prinsengracht 263 ", "city": "  Amsterdam ", "postcode": " 1016 GV "},
        lineItems=[{"description": "  Emergency plumber  ", "amount": "150", "category": " labour "}],
        claimedTotal="150",
    )
    claim = parse_claim(as_json(body))
    assert (claim.address.line1, claim.address.city, claim.address.postcode) == (
        "Prinsengracht 263",
        "Amsterdam",
        "1016 GV",
    )
    assert claim.line_items[0].description == "Emergency plumber"
    assert claim.line_items[0].category == "labour"


def test_tag_lists_are_normalised(make_payload, as_json):
    claim = parse_claim(as_json(make_payload(tags=[" Water ", "URGENT"])))
    assert claim.tags == ["water", "urgent"]


def test_tag_string_with_empty_parts(make_payload, as_json):
    assert parse_claim(as_json(make_payload(tags="Storm,, ROOF ,"))).tags == ["storm", "roof"]


# --- custom messages reach the client unchanged ------------------------------------------------


def test_line_item_amount_message(make_payload, as_json):
    body = make_payload(
        lineItems=[
            {"description": "Plumber", "amount": "150", "category": "labour"},
            {"description": "Refund", "amount": "-20", "category": None},
        ],
        claimedTotal="130",
    )
    assert problems(body, as_json) == [
        {"field": "lineItems.1.amount", "message": "line item amounts must be positive"}
    ]


def test_incident_after_report_message(make_payload, as_json):
    body = make_payload(incidentDate="2026-10-31")
    assert problems(body, as_json) == [
        {"field": None, "message": "incident date cannot be after the report date"}
    ]


def test_whole_claim_rules_wait_for_valid_fields(make_payload, as_json):
    body = make_payload(claimantPhone="12", claimedTotal="9999")
    assert problems(body, as_json) == [
        {"field": "claimantPhone", "message": "phone numbers need 9 to 15 digits"}
    ]


def test_several_problems_are_reported_together(make_payload, as_json):
    body = make_payload(claimantPhone="12", policyNumber="TST-000001")
    assert sorted(p["field"] for p in problems(body, as_json)) == ["claimantPhone", "policyNumber"]


def test_error_body_is_json_serialisable(make_payload, as_json):
    body = make_payload(claimantPhone="12")
    assert json.loads(json.dumps(problems(body, as_json)))[0]["field"] == "claimantPhone"


# --- JSON clients and the document store see -------------------------------------------------------


def test_amounts_are_json_numbers_everywhere(make_payload, as_json):
    body = json.loads(claim_json(parse_claim(as_json(make_payload()))))
    assert body["claimedTotal"] == 1250.5
    assert [item["amount"] for item in body["lineItems"]] == [1100.5, 150]
    for value in [body["claimedTotal"], *(item["amount"] for item in body["lineItems"])]:
        assert isinstance(value, (int, float)) and not isinstance(value, bool)


def test_response_sla_is_seconds(make_payload, as_json):
    body = json.loads(claim_json(parse_claim(as_json(make_payload(responseSla=3600)))))
    assert body["responseSla"] == 3600
    default = json.loads(claim_json(parse_claim(as_json(make_payload()))))
    assert default["responseSla"] == 172800


def test_timestamps_keep_their_offset_format(make_payload, as_json):
    utc = json.loads(claim_json(parse_claim(as_json(make_payload(reportedAt="2026-10-30T09:15:00Z")))))
    assert utc["reportedAt"] == "2026-10-30T09:15:00+00:00"
    cet = json.loads(claim_json(parse_claim(as_json(make_payload(reportedAt="2026-10-30T10:15:00+01:00")))))
    assert cet["reportedAt"] == "2026-10-30T10:15:00+01:00"
    assert utc["incidentDate"] == "2026-10-28"


def test_response_keys_and_nulls(make_payload, as_json):
    body = json.loads(claim_json(parse_claim(as_json(make_payload()))))
    assert set(body) == {
        "schemaVersion", "policyNumber", "claimType", "claimantName", "claimantPhone", "incidentDate",
        "reportedAt", "address", "lineItems", "claimedTotal", "currency", "tags", "policeReportNumber",
        "adjusterNotes", "responseSla", "metadata",
    }
    assert body["policeReportNumber"] is None
    assert body["claimType"] == "home"
    assert body["address"] == {"line1": "Prinsengracht 263", "city": "Amsterdam", "postcode": "1016 GV", "country": "NL"}


def test_document_is_plain_json(make_payload, as_json):
    document = claim_document(parse_claim(as_json(make_payload())))
    assert json.loads(json.dumps(document)) == document
    assert document["lineItems"][0]["amount"] == 1100.5


def test_batch_output(make_payload, as_json):
    claims = parse_batch(as_json([make_payload(), make_payload(policyNumber="TRV-000777", claimType="travel")]))
    body = json.loads(batch_json(claims))
    assert [entry["policyNumber"] for entry in body] == ["HOM-204518", "TRV-000777"]
    assert body[1]["claimedTotal"] == 1250.5
    assert body[1]["responseSla"] == 172800


def test_batch_errors_point_at_the_claim(make_payload, as_json):
    with pytest.raises(ValidationError) as caught:
        parse_batch(as_json([make_payload(), make_payload(claimantPhone="12")]))
    fields = [p["field"] for p in api_errors(caught.value)]
    assert fields == ["1.claimantPhone"]


# --- database rows and edits ---------------------------------------------------------------------


def test_row_round_trip(claim_row):
    claim = claim_from_row(claim_row)
    body = json.loads(claim_json(claim))
    assert body["policyNumber"] == "AUT-771200"
    assert body["claimedTotal"] == 640
    assert body["responseSla"] == 86400
    assert body["metadata"] == {"source": "call-centre"}
    assert body["reportedAt"] == "2026-10-02T08:00:00+00:00"


def test_rows_are_validated(claim_row):
    claim_row.claimed_total = Decimal("1.00")
    with pytest.raises(ValidationError):
        claim_from_row(claim_row)


def test_claims_can_be_built_with_field_names(claim_row):
    claim = claim_from_row(claim_row)
    rebuilt = Claim(**{name: getattr(claim, name) for name in ("policy_number", "claim_type", "claimant_name",
                                                                "claimant_phone", "incident_date", "reported_at",
                                                                "address", "line_items", "claimed_total")})
    assert rebuilt.claimant_name == "Sam Okafor"
    assert rebuilt.currency == "EUR"


def test_edits_are_revalidated(make_payload, as_json):
    claim = parse_claim(as_json(make_payload()))
    with pytest.raises(ValidationError):
        with_changes(claim, claimed_total=Decimal("1.00"))
    assert with_changes(claim, currency="gbp").currency == "GBP"
    assert with_changes(claim, tags="Mould").tags == ["mould"]
