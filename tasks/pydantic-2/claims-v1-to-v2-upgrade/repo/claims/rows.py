"""Plain row objects, shaped like what the database layer returns."""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, List, Optional


@dataclass
class AddressRow:
    line1: str
    city: str
    postcode: str
    country: str = "NL"


@dataclass
class LineItemRow:
    description: str
    amount: Decimal
    category: Optional[str] = None


@dataclass
class ClaimRow:
    policy_number: str
    claim_type: str
    claimant_name: str
    claimant_phone: str
    incident_date: date
    reported_at: datetime
    address: AddressRow
    line_items: List[LineItemRow]
    claimed_total: Decimal
    currency: str = "EUR"
    tags: List[str] = field(default_factory=list)
    police_report_number: Optional[str] = None
    adjuster_notes: Optional[str] = None
    response_sla: timedelta = timedelta(hours=48)
    metadata: Any = None
    schema_version: int = 2
