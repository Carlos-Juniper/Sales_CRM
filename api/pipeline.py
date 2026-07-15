"""
Pipeline functions for promoting HOA properties to leads.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from db import query, execute, count_active_leads_for_property
from models import Lead


async def promote_hoa_to_lead(hoa_property_id: str) -> Lead:
    """Convert an HOA property catalog entry into a sales Lead.

    If an active (non-won, non-lost) lead already exists for this property,
    the existing lead is returned instead of creating a duplicate.
    """
    rows = await query(
        "SELECT * FROM hoa_properties WHERE id = %s",
        [hoa_property_id],
    )
    if not rows:
        raise ValueError(f"HOA property {hoa_property_id} not found")

    hoa = rows[0]

    # Guard: return the existing active lead instead of creating a duplicate
    if await count_active_leads_for_property(hoa_property_id) > 0:
        existing_rows = await query(
            """
            SELECT * FROM leads
            WHERE hoa_property_id = %s
              AND status NOT IN ('won', 'lost')
              AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [hoa_property_id],
        )
        if existing_rows:
            existing = existing_rows[0]
            acreage = existing.get("estimated_acreage")
            if isinstance(acreage, Decimal):
                acreage = float(acreage)
            return Lead(
                id=existing["id"],
                source=existing.get("source", "hoa_catalog"),
                lead_type=existing.get("lead_type", "HOA"),
                property_name=existing.get("property_name", ""),
                address=existing.get("address", ""),
                city=existing.get("city", ""),
                state=existing.get("state", ""),
                zip=existing.get("zip", ""),
                source_url=existing.get("source_url", ""),
                estimated_acreage=acreage,
                branch_id=existing.get("branch_id"),
                hoa_property_id=hoa_property_id,
                status=existing.get("status", "new"),
            )

    lead_id = str(uuid.uuid4())
    lead = Lead(
        id=lead_id,
        source="hoa_catalog",
        lead_type="HOA",
        property_name=hoa.get("property_name", ""),
        address=hoa.get("address", ""),
        city=hoa.get("city", ""),
        state=hoa.get("state", ""),
        zip=hoa.get("zip", ""),
        source_url=hoa.get("arcgis_source", ""),
        estimated_acreage=hoa.get("estimated_acreage"),
        branch_id=hoa.get("branch_id"),
        hoa_property_id=hoa_property_id,
        status="new",
    )

    await execute(
        """
        INSERT INTO leads
            (id, source, lead_type, property_name, city, state,
             estimated_contract_value, estimated_acreage, status,
             contact_name, contact_email, address, zip, bid_deadline,
             hoa_property_id, branch_id, created_at, updated_at)
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
            lead.hoa_property_id,
            lead.branch_id,
        ],
    )

    # NOTE: property pipeline status is NOT changed on promote — managed manually

    return lead


async def set_property_contacted(hoa_property_id: str) -> None:
    """Mark an HOA property as contacted.

    Called when a bid moves to pursuing — the first real contact event.
    Idempotent: safe to call if already contacted.
    """
    await execute(
        "UPDATE hoa_properties SET contact_status = 'contacted', updated_at = CURRENT_TIMESTAMP() WHERE id = %s",
        [hoa_property_id],
    )
