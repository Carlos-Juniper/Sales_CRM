"""
Pipeline functions for promoting HOA properties to leads.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import aiomysql
from db import get_pool
from models import Lead


async def promote_hoa_to_lead(hoa_property_id: str) -> Lead:
    """Convert an HOA property catalog entry into a sales Lead."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # Fetch the HOA property
            await cur.execute(
                "SELECT * FROM hoa_properties WHERE id = %s",
                (hoa_property_id,),
            )
            hoa_row = await cur.fetchone()
            if not hoa_row:
                raise ValueError(f"HOA property {hoa_property_id} not found")

            hoa_row = dict(hoa_row)

            # Create a new Lead from the HOA property
            lead_id = str(uuid.uuid4())
            lead = Lead(
                id=lead_id,
                source="hoa_catalog",
                lead_type="HOA",
                property_name=hoa_row.get("property_name", ""),
                address=hoa_row.get("address", ""),
                city=hoa_row.get("city", ""),
                state=hoa_row.get("state", ""),
                zip=hoa_row.get("zip", ""),
                source_url=hoa_row.get("arcgis_source", ""),
                estimated_acreage=hoa_row.get("estimated_acreage"),
                branch_id=hoa_row.get("branch_id"),
                hoa_property_id=hoa_property_id,
                status="new",
            )

            # Insert the lead into the database
            await cur.execute(
                """
                INSERT INTO leads
                    (id, source, lead_type, property_name, city, state,
                     estimated_contract_value, estimated_acreage, status,
                     contact_name, contact_email, address, zip, bid_deadline,
                     hoa_property_id, branch_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    lead.id,
                    lead.source,
                    lead.lead_type,
                    lead.property_name,
                    lead.city,
                    lead.state,
                    lead.estimated_contract_value,
                    lead.estimated_acreage,
                    lead.status,
                    lead.contact_name,
                    lead.contact_email,
                    lead.address,
                    lead.zip,
                    lead.bid_deadline,
                    lead.hoa_property_id,
                    lead.branch_id,
                ),
            )

            # Update HOA property status to contacted
            await cur.execute(
                "UPDATE hoa_properties SET status = 'contacted', updated_at = NOW() WHERE id = %s",
                (hoa_property_id,),
            )

    return lead
