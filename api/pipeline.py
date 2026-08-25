"""
Pipeline functions for promoting prospects into sales Leads.

Canonical-properties model: every vertical prospecting table (hoa_properties
today; hospitals/cemeteries/parks later) feeds into the canonical `properties`
table on engagement. Promotion find-or-creates a `properties` row (idempotent
via the UNIQUE (source_type, source_id) key) and inserts the lead with
`leads.property_id` — `leads.hoa_property_id` no longer exists.

Promotion is LOCAL-ONLY: the created property stays aspire_sync_status
='unsynced'. The one and only Aspire push trigger is estimate submission
(api/estimating.py → api.properties.sync_property_if_needed).
"""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass
from decimal import Decimal
from typing import Any, Optional

from db import query, execute, count_active_leads_for_property


@dataclass
class Lead:
    """Lightweight lead record returned by the promote flows."""

    id: str
    source: str
    lead_type: str
    property_name: str
    address: str = ""
    city: str = ""
    state: str = ""
    zip: str = ""
    source_url: str = ""
    estimated_acreage: Optional[float] = None
    branch_id: Optional[str] = None
    property_id: Optional[str] = None
    status: str = "new"
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    bid_deadline: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _as_float(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    return v


def _lead_from_row(row: dict, property_id: Optional[str]) -> Lead:
    return Lead(
        id=row["id"],
        source=row.get("source", "hoa_catalog"),
        lead_type=row.get("lead_type", "HOA"),
        property_name=row.get("property_name", ""),
        address=row.get("address", ""),
        city=row.get("city", ""),
        state=row.get("state", ""),
        zip=row.get("zip", ""),
        source_url=row.get("source_url", ""),
        estimated_acreage=_as_float(row.get("estimated_acreage")),
        branch_id=row.get("branch_id"),
        property_id=row.get("property_id") or property_id,
        status=row.get("status", "new"),
    )


async def _existing_active_lead(property_id: str) -> Optional[dict]:
    rows = await query(
        """
        SELECT * FROM leads
        WHERE property_id = %s
          AND status NOT IN ('won', 'lost')
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        """,
        [property_id],
    )
    return rows[0] if rows else None


async def _insert_lead(lead: Lead) -> None:
    await execute(
        """
        INSERT INTO leads
            (id, source, lead_type, property_name, city, state,
             estimated_contract_value, estimated_acreage, status,
             contact_name, contact_email, address, zip, bid_deadline,
             property_id, branch_id, created_at, updated_at)
        VALUES
            (%s, %s, %s, %s, %s, %s,
             %s, %s, %s,
             %s, %s, %s, %s, %s,
             %s, %s, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            lead.id,
            lead.source,
            lead.lead_type,
            lead.property_name,
            lead.city,
            lead.state,
            None,
            lead.estimated_acreage,
            lead.status,
            lead.contact_name,
            lead.contact_email,
            lead.address,
            lead.zip,
            lead.bid_deadline,
            lead.property_id,
            lead.branch_id,
        ],
    )


async def find_or_create_property_for_hoa(hoa: dict) -> str:
    """Find-or-create the canonical `properties` row for an HOA prospect.

    Idempotent via the UNIQUE (source_type, source_id) key: one vertical row
    promotes to exactly one property. LOCAL-ONLY — the new row is 'unsynced'
    and no Aspire call is made here.
    """
    hoa_id = hoa["id"]
    rows = await query(
        "SELECT id FROM properties WHERE source_type = %s AND source_id = %s",
        ["hoa", hoa_id],
    )
    if rows:
        return rows[0]["id"]

    property_id = str(uuid.uuid4())
    await execute(
        """
        INSERT INTO properties
            (id, property_type, source_type, source_id, name, address1,
             city, state, zip, branch_city, customer_type,
             management_company_id, aspire_sync_status)
        VALUES
            (%s, 'hoa', 'hoa', %s, %s, %s, %s, %s, %s, %s, 'hoa', %s, 'unsynced')
        ON DUPLICATE KEY UPDATE id = id
        """,
        [
            property_id,
            hoa_id,
            hoa.get("property_name", ""),
            hoa.get("address", ""),
            hoa.get("city", ""),
            hoa.get("state", ""),
            hoa.get("zip", ""),
            hoa.get("branch_id"),
            hoa.get("management_company_id"),
        ],
    )
    # Authoritative re-read: under a concurrent promote the UNIQUE key wins and
    # the surviving row's id may differ from the one we generated.
    rows = await query(
        "SELECT id FROM properties WHERE source_type = %s AND source_id = %s",
        ["hoa", hoa_id],
    )
    return rows[0]["id"] if rows else property_id


async def promote_hoa_to_lead(hoa_property_id: str) -> Lead:
    """Convert an HOA property catalog entry into a sales Lead.

    Resolves (find-or-create) the canonical `properties` row first, then
    creates the lead keyed by `property_id`. If an active (non-won, non-lost)
    lead already exists for the property, it is returned instead of a
    duplicate. No Aspire push happens here (§5.1).
    """
    rows = await query(
        "SELECT * FROM hoa_properties WHERE id = %s",
        [hoa_property_id],
    )
    if not rows:
        raise ValueError(f"HOA property {hoa_property_id} not found")

    hoa = rows[0]
    property_id = await find_or_create_property_for_hoa(hoa)

    # Guard: return the existing active lead instead of creating a duplicate
    if await count_active_leads_for_property(property_id) > 0:
        existing = await _existing_active_lead(property_id)
        if existing:
            return _lead_from_row(existing, property_id)

    lead = Lead(
        id=str(uuid.uuid4()),
        source="hoa_catalog",
        lead_type="HOA",
        property_name=hoa.get("property_name", ""),
        address=hoa.get("address", ""),
        city=hoa.get("city", ""),
        state=hoa.get("state", ""),
        zip=hoa.get("zip", ""),
        source_url=hoa.get("arcgis_source", ""),
        estimated_acreage=_as_float(hoa.get("estimated_acreage")),
        branch_id=hoa.get("branch_id"),
        property_id=property_id,
        status="new",
    )
    await _insert_lead(lead)

    # NOTE: property pipeline status is NOT changed on promote — managed manually

    return lead


def _lead_type_for_property(property_type: Optional[str]) -> str:
    if not property_type or property_type == "manual":
        return "MANUAL"
    return "HOA" if property_type == "hoa" else property_type.upper()


async def promote_property_to_lead(property_id: str) -> Lead:
    """Create a sales Lead from a canonical `properties` row (generalized
    promote — §5.5). Dedups on an existing active lead. Local-only;
    no Aspire push."""
    rows = await query("SELECT * FROM properties WHERE id = %s", [property_id])
    if not rows:
        raise ValueError(f"Property {property_id} not found")
    prop = rows[0]

    if await count_active_leads_for_property(property_id) > 0:
        existing = await _existing_active_lead(property_id)
        if existing:
            return _lead_from_row(existing, property_id)

    lead = Lead(
        id=str(uuid.uuid4()),
        source="property",
        lead_type=_lead_type_for_property(prop.get("property_type")),
        property_name=prop.get("name", ""),
        address=prop.get("address1", ""),
        city=prop.get("city", ""),
        state=prop.get("state", ""),
        zip=prop.get("zip", ""),
        branch_id=prop.get("branch_city"),
        property_id=property_id,
        status="new",
    )
    await _insert_lead(lead)
    return lead


async def set_property_contacted(hoa_property_id: str) -> None:
    """Mark an HOA property as contacted.

    Called when a bid moves to pursuing — the first real contact event.
    Callers resolve the HOA id via properties.source_id (§5.3).
    Idempotent: safe to call if already contacted.
    """
    await execute(
        "UPDATE hoa_properties SET contact_status = 'contacted', updated_at = CURRENT_TIMESTAMP() WHERE id = %s",
        [hoa_property_id],
    )
