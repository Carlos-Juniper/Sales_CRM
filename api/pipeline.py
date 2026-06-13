"""
Pipeline functions for promoting HOA properties to leads.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from db import T, P, PA, query, execute, count_active_leads_for_property
from models import Lead


async def promote_hoa_to_lead(hoa_property_id: str) -> Lead:
    """Convert an HOA property catalog entry into a sales Lead.

    If an active (non-won, non-lost) lead already exists for this property,
    the existing lead is returned instead of creating a duplicate.
    """
    rows = await query(
        f"SELECT * FROM {T('hoa_properties')} WHERE id = @id",
        [P("id", "STRING", hoa_property_id)],
    )
    if not rows:
        raise ValueError(f"HOA property {hoa_property_id} not found")

    hoa = rows[0]

    # Guard: return the existing active lead instead of creating a duplicate
    if await count_active_leads_for_property(hoa_property_id) > 0:
        existing_rows = await query(
            f"""
            SELECT * FROM {T('leads')}
            WHERE hoa_property_id = @id
              AND status NOT IN UNNEST(@statuses)
              AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [
                P("id", "STRING", hoa_property_id),
                PA("statuses", "STRING", ["won", "lost"]),
            ],
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
        f"""
        INSERT INTO {T('leads')}
            (id, source, lead_type, property_name, city, state,
             estimated_contract_value, estimated_acreage, status,
             contact_name, contact_email, address, zip, bid_deadline,
             hoa_property_id, branch_id, created_at, updated_at)
        VALUES
            (@id, @source, @lead_type, @property_name, @city, @state,
             @estimated_contract_value, @estimated_acreage, @status,
             @contact_name, @contact_email, @address, @zip, @bid_deadline,
             @hoa_property_id, @branch_id, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
        """,
        [
            P("id", "STRING", lead.id),
            P("source", "STRING", lead.source),
            P("lead_type", "STRING", lead.lead_type),
            P("property_name", "STRING", lead.property_name),
            P("city", "STRING", lead.city),
            P("state", "STRING", lead.state),
            P("estimated_contract_value", "FLOAT64", None),
            P("estimated_acreage", "FLOAT64", lead.estimated_acreage),
            P("status", "STRING", lead.status),
            P("contact_name", "STRING", lead.contact_name),
            P("contact_email", "STRING", lead.contact_email),
            P("address", "STRING", lead.address),
            P("zip", "STRING", lead.zip),
            P("bid_deadline", "DATE", lead.bid_deadline),
            P("hoa_property_id", "STRING", lead.hoa_property_id),
            P("branch_id", "STRING", lead.branch_id),
        ],
    )

    # NOTE: property pipeline status is NOT changed on promote — managed manually

    return lead


async def set_property_contacted(hoa_property_id: str) -> None:
    """Mark an HOA property as contacted.

    Called when outreach is sent or a bid moves to pursuing — the first real
    contact event. Idempotent: safe to call if already contacted.
    """
    await execute(
        f"UPDATE {T('hoa_properties')} SET contact_status = 'contacted', updated_at = CURRENT_TIMESTAMP() WHERE id = @id",
        [P("id", "STRING", hoa_property_id)],
    )
