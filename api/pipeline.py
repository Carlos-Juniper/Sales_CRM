"""
Pipeline functions for promoting HOA properties to leads.
"""
from __future__ import annotations

import uuid

from db import T, P, query, execute
from models import Lead


async def promote_hoa_to_lead(hoa_property_id: str) -> Lead:
    """Convert an HOA property catalog entry into a sales Lead."""
    rows = await query(
        f"SELECT * FROM {T('hoa_properties')} WHERE id = @id",
        [P("id", "STRING", hoa_property_id)],
    )
    if not rows:
        raise ValueError(f"HOA property {hoa_property_id} not found")

    hoa = rows[0]
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

    await execute(
        f"UPDATE {T('hoa_properties')} SET status = 'contacted', updated_at = CURRENT_TIMESTAMP() WHERE id = @id",
        [P("id", "STRING", hoa_property_id)],
    )

    return lead
