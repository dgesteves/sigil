import json

from claims.api import batch_json, claim_document, claim_from_row, claim_json, parse_claim


def test_claim_response_body(make_payload, as_json):
    body = json.loads(claim_json(parse_claim(as_json(make_payload()))))
    assert body["policyNumber"] == "HOM-204518"
    assert body["schemaVersion"] == 2
    # The mobile app and the partner portals read amounts as JSON numbers.
    assert body["claimedTotal"] == 1250.5
    assert body["reportedAt"] == "2026-10-30T09:15:00+00:00"


def test_document_matches_the_response(make_payload, as_json):
    claim = parse_claim(as_json(make_payload()))
    assert claim_document(claim) == json.loads(claim_json(claim))


def test_batch_is_a_json_array(make_payload, as_json):
    claims = [parse_claim(as_json(make_payload()))]
    body = json.loads(batch_json(claims))
    assert isinstance(body, list)
    assert body[0]["policyNumber"] == "HOM-204518"


def test_claims_load_from_database_rows(claim_row):
    claim = claim_from_row(claim_row)
    assert claim.claimant_name == "Sam Okafor"
    assert claim.address.city == "Rotterdam"
    assert claim.line_items[0].category == "bodywork"
