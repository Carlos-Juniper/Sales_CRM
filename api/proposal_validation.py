"""Pre-send guard for proposal renders (Handoff 46 §5).

Blocks a headless-Chromium render when the proposal's resolved data still
contains MVP placeholder values from migration 015 (or a future regression):

  - team_member.name containing "Placeholder" (case-insensitive)
  - client_reference.phone matching the 555-01xx fictional range
  - company environment variables VITE_COMPANY_NAME or VITE_COMPANY_ADDRESS
    being empty — either signals an unconfigured deployment

The public surface is two functions:

  check_proposal_render_data(resolved) -> list[GuardIssue]
      Pure function; takes a pre-resolved dict. Used directly in unit tests and
      by validate_proposal_for_render() below.

  validate_proposal_for_render(proposal_id) -> list[GuardIssue]
      Async; queries the DB for the team members and client references that are
      actually referenced by the proposal, then delegates to the pure function.
      Called from the render and validate endpoints.

The "resolved" dict shape (as assembled by validate_proposal_for_render):

    {
        "team_members":      [{"id": str, "name": str | None}, ...],
        "client_references": [{"id": str, "phone": str | None}, ...],
        "company_info":      {"name": str, "address": str},
    }

company_info.name and company_info.address are sourced from the VITE_COMPANY_NAME
and VITE_COMPANY_ADDRESS environment variables, which the React print route also
reads via its Vite build. An empty value here means the PDF will print blank
company identity, which is always a blocking defect.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any

try:  # keep the module importable in unit tests that never touch the DB
    from db import query
except Exception:  # pragma: no cover - db unavailable at import time
    query = None  # type: ignore[assignment]


# ── Pattern constants ─────────────────────────────────────────────────────────

# The literal string "Placeholder" (case-insensitive) in any team member name.
_PLACEHOLDER_RE = re.compile(r'\bplaceholder\b', re.IGNORECASE)

# North-American 555-01xx block — NANP reserved for fictional use (TV/film).
# Matches (NXX) 555-01xx, 555-01xx, or NXX-555-01xx with any separator.
_FICTIONAL_PHONE_RE = re.compile(r'555[-.\s]?01\d\d')


# ── Result type ───────────────────────────────────────────────────────────────

@dataclass
class GuardIssue:
    """A single blocking defect found in resolved proposal data."""
    field: str    # dotted path, e.g. "team_member[tm-001].name"
    value: str    # the offending value (empty string if the field is absent)
    reason: str   # human-readable explanation for the UI toast


# ── Pure validation (unit-testable, no I/O) ───────────────────────────────────

def check_proposal_render_data(resolved: dict[str, Any]) -> list[GuardIssue]:
    """Return all blocking defects in a resolved proposal data dict.

    A non-empty return value means the render must be blocked.  The caller is
    responsible for converting the list into an HTTP 422 response.

    Args:
        resolved: Dict with keys ``team_members``, ``client_references``, and
            ``company_info``.  Missing keys are treated as empty collections /
            empty strings — not as errors in themselves (presence of an empty
            collection is fine; only the values inside are checked).

    Returns:
        List of GuardIssue instances.  Empty list means data is clean.
    """
    issues: list[GuardIssue] = []

    # ── team_members: block on "Placeholder" anywhere in the name ────────────
    for member in resolved.get('team_members', []):
        name = member.get('name') or ''
        if _PLACEHOLDER_RE.search(name):
            member_id = member.get('id', '?')
            issues.append(GuardIssue(
                field=f"team_member[{member_id}].name",
                value=name,
                reason="contains 'Placeholder' — replace with a real team member name",
            ))

    # ── client_references: block on 555-01xx fictional phone numbers ──────────
    for ref in resolved.get('client_references', []):
        phone = ref.get('phone') or ''
        if _FICTIONAL_PHONE_RE.search(phone):
            ref_id = ref.get('id', '?')
            issues.append(GuardIssue(
                field=f"client_reference[{ref_id}].phone",
                value=phone,
                reason="fictional 555-01xx phone — replace with a real contact number",
            ))

    # ── company_info: block on empty required env-backed fields ───────────────
    company = resolved.get('company_info', {})
    for key in ('name', 'address'):
        if not (company.get(key) or '').strip():
            issues.append(GuardIssue(
                field=f"company_info.{key}",
                value='',
                reason=f"empty required field — set VITE_COMPANY_{key.upper()} in the environment",
            ))

    return issues


# ── Async resolver (DB + env → resolved dict → issues) ────────────────────────

async def validate_proposal_for_render(proposal_id: str) -> list[GuardIssue]:
    """Resolve a proposal's referenced data from the DB and validate it.

    Queries team_members and client_references for the ids stored in the
    proposal_requests row, then reads VITE_COMPANY_NAME / VITE_COMPANY_ADDRESS
    from the process environment (same source the React build uses).

    Args:
        proposal_id: The proposal_requests.id to validate.

    Returns:
        List of GuardIssue instances.  Empty list means the proposal is safe to
        render.  Raises RuntimeError if the proposal row is not found.
    """
    from db import query  # local import — keeps the module importable without DB

    # Load the proposal to get the id lists.
    prop_rows = await query(
        "SELECT team_member_ids, client_reference_ids "
        "FROM proposal_requests WHERE id = %s",
        (proposal_id,),
    )
    if not prop_rows:
        raise RuntimeError(f"Proposal '{proposal_id}' not found")

    import json

    prop = prop_rows[0]

    def _decode_ids(raw: Any) -> list[str]:
        """Decode a JSON id-list column, tolerating str or list from aiomysql."""
        if isinstance(raw, (str, bytes, bytearray)):
            try:
                decoded = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return []
        else:
            decoded = raw
        if isinstance(decoded, list):
            return [str(x) for x in decoded if x]
        return []

    team_ids = _decode_ids(prop.get('team_member_ids'))
    ref_ids = _decode_ids(prop.get('client_reference_ids'))

    # Fetch only the fields the guard needs to avoid selecting large blobs.
    team_members: list[dict] = []
    if team_ids:
        placeholders = ', '.join(['%s'] * len(team_ids))
        rows = await query(
            f"SELECT id, name FROM team_members WHERE id IN ({placeholders})",
            team_ids,
        )
        team_members = [{'id': str(r['id']), 'name': r.get('name')} for r in rows]

    client_references: list[dict] = []
    if ref_ids:
        placeholders = ', '.join(['%s'] * len(ref_ids))
        rows = await query(
            f"SELECT id, phone FROM client_references WHERE id IN ({placeholders})",
            ref_ids,
        )
        client_references = [{'id': str(r['id']), 'phone': r.get('phone')} for r in rows]

    # Company identity — sourced from env vars; same values the React build uses.
    company_info = {
        'name': os.environ.get('VITE_COMPANY_NAME', ''),
        'address': os.environ.get('VITE_COMPANY_ADDRESS', ''),
    }

    resolved = {
        'team_members': team_members,
        'client_references': client_references,
        'company_info': company_info,
    }

    return check_proposal_render_data(resolved)


# ── Non-blocking pre-send warnings (Handoff 47 §7) ────────────────────────────

async def proposal_document_warnings(
    estimate_id: str | None = None,
    lead_id: str | None = None,
) -> list[str]:
    """Return non-blocking warnings about the proposal's documents.

    Currently one check: a missing proposal_contract. A missing contract is
    usually a mistake, but sending an early draft without one is legitimate, so
    this is a WARNING (a plain string the UI surfaces), never a GuardIssue that
    blocks the render. Deliberately does NOT add a second hard block to a gate
    that already hard-blocks every render while VITE_COMPANY_ADDRESS is empty.

    WS2: when estimate_id is None and lead_id is provided, the contract is
    resolved by lead_id instead (estimate-optional proposals, before uploads
    are re-anchored to an estimate).
    """
    if estimate_id:
        rows = await query(
            """
            SELECT COUNT(*) AS cnt FROM intake_attachments
             WHERE estimate_id = %s
               AND kind = 'proposal_contract'
               AND status = 'stored'
            """,
            (estimate_id,),
        )
    elif lead_id:
        rows = await query(
            """
            SELECT COUNT(*) AS cnt FROM intake_attachments
             WHERE lead_id = %s
               AND estimate_id IS NULL
               AND kind = 'proposal_contract'
               AND status = 'stored'
            """,
            (lead_id,),
        )
    else:
        rows = [{"cnt": 0}]

    contract_count = int(rows[0]["cnt"]) if rows else 0
    if contract_count == 0:
        return [
            "No contract document is attached. The proposal will be generated "
            "without the Aspire contract pages appended."
        ]
    return []


async def proposal_team_bio_warnings(team_member_ids: list[str]) -> list[str]:
    """Return non-blocking warnings for selected team members who have no bio.

    An empty bio is not a hard block (TeamMemberCreate.bio defaults to '' and
    many manager rows are seeded empty), but the rep should know before sending
    that those cards will render without body text. Uses a WARNING string, never
    a GuardIssue — GuardIssues hard-422 and would block every proposal that
    picks a manager with a blank bio.

    Args:
        team_member_ids: The list of team_member id strings selected for the
            proposal (team_member_ids JSON column, decoded).

    Returns:
        One warning string per member whose bio is NULL or empty string.
        Empty list when all selected members have bio text.
    """
    if not team_member_ids:
        return []

    if query is None:  # pragma: no cover - db unavailable at import time
        return []

    placeholders = ", ".join(["%s"] * len(team_member_ids))
    rows = await query(
        f"SELECT id, name, bio FROM team_members WHERE id IN ({placeholders})",
        team_member_ids,
    )
    warnings: list[str] = []
    for r in rows:
        bio = (r.get("bio") or "").strip()
        if not bio:
            name = r.get("name") or r["id"]
            warnings.append(
                f"Team member '{name}' has no bio; their card will print without body text."
            )
    return warnings
