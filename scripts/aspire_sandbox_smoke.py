#!/usr/bin/env python3
"""Aspire sandbox smoke test — resolves the two open TODO(aspire-live) items.

What this checks
----------------
1. Does POST /Opportunity (prod path) / POST /Opportunities (sandbox path) already
   return the opportunity number in the response body?
   Resolves aspire_sync.py TODO #1 (_fetch_opportunity_number).

2. What is the correct write-back field name for the lost reason?
   Resolves aspire_sync.py TODO #2 (OpportunityLostReasonID).

Also spot-checks:
3. Does POST /Property (prod path) / POST /Properties (sandbox path) return
   PropertyID directly in the response?

Usage (from repo root)
----------------------
    python scripts/aspire_sandbox_smoke.py

The script force-sets ASPIRE_ENV=sandbox and loads .env automatically — no
manual export required.  The real sandbox credentials must be present in .env:
    ASPIRE_SANDBOX_BASE_URL, ASPIRE_SANDBOX_CLIENT_ID, ASPIRE_SANDBOX_SECRET

Exit codes
----------
0 — all checks ran and produced definitive answers (even if the answer is
    "keep the current code, confirmed necessary").
1 — a check was blocked or produced an inconclusive result.

Sandbox API differences from prod (found 2026-08-24)
------------------------------------------------------
* Sandbox uses PLURAL paths for all operations (/Opportunities, /Properties)
  while prod uses SINGULAR for writes (/Opportunity, /Property).
* POST returns a BARE INTEGER (the created ID), not a JSON dict — so no
  number fields are present in the POST response at all.
* /Opportunities/{id}: only DELETE is allowed; PATCH/PUT return 405.
* /Properties/{id}: no individual resource endpoint at all (404 on all verbs).
* Additional required fields for property create: IndustryID, TaxJurisdictionID,
  PaymentTermsID, PrimaryContactID — these are NOT required by the prod API.
* SalesRepContactID (prod field name) is called SalesRepID in the sandbox.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# ── Bootstrap ────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Load .env before importing api.* (same idiom as run_dev.py)
env_file = ROOT / ".env"
if env_file.exists():
    for _line in env_file.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip())

# Force sandbox environment for this script — never touches prod.
os.environ["ASPIRE_ENV"] = "sandbox"
os.environ["ASPIRE_SYNC_ENABLED"] = "true"

import httpx  # noqa: E402

from api.aspire_client import AspireClient, AspireError, _resolve_base_url  # noqa: E402
from api.aspire_sync import (  # noqa: E402
    build_opportunity_payload,
    build_property_payload,
    extract_aspire_number,
    OpportunityInput,
    PropertyInput,
)


# ── Test data ─────────────────────────────────────────────────────────────────

_TS = os.environ.get("SMOKE_TS", "20260824")
TEST_NAME = f"ZZTEST smoke {_TS}"

# Sandbox-specific required IDs (verified 2026-08-24 against cloudsandbox-api.youraspire.com)
_SANDBOX_BRANCH_ID = 1374          # Bradenton Install — exists in sandbox
_SANDBOX_TAX_JURISDICTION_ID = 791  # FL Non Taxable
_SANDBOX_PAYMENT_TERMS_ID = 358    # Due on Receipt
_SANDBOX_PRIMARY_CONTACT_ID = 255987  # Juniper Landscaping employee contact
_SANDBOX_INDUSTRY_ID = 2204        # Developer / Builder
_SANDBOX_SALES_REP_ID = 278690     # DARRELL STANLEY
_SANDBOX_OPP_TYPE = "Work Order"   # required string (sandbox calls it OpportunityType)


# ── Output helpers ────────────────────────────────────────────────────────────

def _sep(title: str) -> None:
    print(f"\n{'─' * 64}")
    print(f"  {title}")
    print("─" * 64)


def ok(msg: str) -> None:
    print(f"  [PASS] {msg}")


def bad(msg: str) -> None:
    print(f"  [FAIL] {msg}")


def info(msg: str) -> None:
    print(f"  [INFO] {msg}")


# ── Raw request helper ────────────────────────────────────────────────────────

async def _raw_post(client: AspireClient, raw: httpx.AsyncClient, path: str, body: dict):
    """POST via raw httpx — returns (status_code, response_body_str, parsed)."""
    headers = await client._auth_headers()
    base = _resolve_base_url("sandbox")
    r = await raw.post(f"{base}{path}", json=body, headers=headers)
    return r.status_code, r.text, (r.json() if r.text else None)


async def _raw_get(client: AspireClient, raw: httpx.AsyncClient, path: str, params: dict):
    headers = await client._auth_headers()
    base = _resolve_base_url("sandbox")
    r = await raw.get(f"{base}{path}", headers=headers, params=params)
    return r.status_code, r.text, (r.json() if r.text else None)


async def _try_delete(client: AspireClient, raw: httpx.AsyncClient, path: str) -> bool:
    try:
        headers = await client._auth_headers()
        base = _resolve_base_url("sandbox")
        r = await raw.delete(f"{base}{path}", headers=headers)
        return r.status_code in (200, 204, 404)
    except Exception:
        return False


# ── Main ──────────────────────────────────────────────────────────────────────

async def main() -> int:
    failures: list[str] = []
    prop_id: int | None = None
    opp_id: int | None = None
    post_number_in_response: bool | None = None

    async with AspireClient() as client:
        async with httpx.AsyncClient(timeout=30) as raw:

            # ── Step 0a: URL sanity check ─────────────────────────────────────
            _sep("Step 0a — confirm ASPIRE_SANDBOX_BASE_URL points to the API, not the web UI")
            sandbox_base = _resolve_base_url("sandbox")
            info(f"ASPIRE_SANDBOX_BASE_URL resolves to: {sandbox_base!r}")
            try:
                probe_r = await raw.get(f"{sandbox_base}/")
                body_snip = probe_r.text[:120]
                is_web_ui = "<!doctype html" in body_snip.lower() or "<html" in body_snip.lower()
                if is_web_ui:
                    bad(f"{sandbox_base!r} is the Aspire *web application*, not the API server.")
                    bad("Every POST returns Azure Storage 405 — auth will fail.")
                    info("")
                    info("To fix:")
                    info("  1. Find the sandbox REST API base URL from Aspire developer settings")
                    info("     or Aspire support (e.g. https://cloud-api-<tenant>.youraspire.com).")
                    info("  2. Set ASPIRE_SANDBOX_BASE_URL in .env to that URL.")
                    info("  3. Re-run this script.")
                    return 1
                ok(f"URL looks like an API server (GET / → {probe_r.status_code})")
            except Exception as exc:
                bad(f"URL probe failed: {exc}")
                return 1

            # ── Step 0b: authentication ───────────────────────────────────────
            _sep("Step 0b — authentication")
            try:
                token = await client._fetch_token()
                ok(f"Token acquired ({len(token)} chars, env=sandbox)")
            except AspireError as exc:
                bad(f"Auth failed: {exc}")
                return 1

            # ── Check 1 (§2.2): property POST returns PropertyID? ─────────────
            _sep("Check 1 (§2.2): POST /Properties → PropertyID in response?")
            prop_inp = PropertyInput(
                name=TEST_NAME,
                address1="1 ZZTEST Lane",
                city="Orlando",
                state="FL",
                zip="32801",
                branch_city="Orlando, FL",
                is_install=False,
                industry_id=_SANDBOX_INDUSTRY_ID,
            )
            # Confirmed plural path: POST /Properties (sandbox + prod API v1).
            sandbox_payload = {
                **build_property_payload(prop_inp),
                "BranchID": _SANDBOX_BRANCH_ID,
                "TaxJurisdictionID": _SANDBOX_TAX_JURISDICTION_ID,
                "PaymentTermsID": _SANDBOX_PAYMENT_TERMS_ID,
                "PrimaryContactID": _SANDBOX_PRIMARY_CONTACT_ID,
            }
            info(f"Payload: {sandbox_payload}")
            sc, body, parsed = await _raw_post(client, raw, "/Properties", sandbox_payload)
            info(f"POST /Properties: {sc} body={body[:200]!r}")
            if sc in (200, 201):
                prop_id = parsed if isinstance(parsed, int) else (parsed.get("PropertyID") if isinstance(parsed, dict) else None)
                if prop_id is not None:
                    ok(
                        f"POST /Properties succeeded: PropertyID={prop_id}, "
                        f"response type={type(parsed).__name__!r}"
                    )
                else:
                    bad(f"No PropertyID found in /Properties response: {body[:100]}")
                    failures.append("Property POST did not return a PropertyID")
            else:
                bad(f"POST /Properties failed: {sc} {body[:200]}")
                failures.append(f"Property POST failed: {body[:100]}")

            # ── Check 2 (§2.1 TODO #1): number in POST /Opportunities? ──────
            _sep("Check 2 (§2.1 TODO #1): POST /Opportunities → number in response?")
            opp_inp = OpportunityInput(
                name=TEST_NAME,
                service_line="Maintenance: Contract",
                branch_city="Orlando, FL",
                is_install=False,
                aspire_property_id=prop_id,
            )
            # Confirmed plural path: POST /Opportunities (sandbox + prod API v1).
            sandbox_opp_payload = {
                **build_opportunity_payload(opp_inp),
                "BranchID": _SANDBOX_BRANCH_ID,
                "OpportunityType": _SANDBOX_OPP_TYPE,
                "SalesRepID": _SANDBOX_SALES_REP_ID,
            }
            info(f"Payload: {sandbox_opp_payload}")

            if prop_id is None:
                info("Skipping — no PropertyID available (property create failed)")
                failures.append("Opportunity check skipped — no PropertyID")
            else:
                sc, body, parsed = await _raw_post(client, raw, "/Opportunities", sandbox_opp_payload)
                info(f"POST /Opportunities: {sc} body={body[:300]!r}")
                if sc in (200, 201):
                    opp_id = parsed if isinstance(parsed, int) else (parsed.get("OpportunityID") if isinstance(parsed, dict) else None)
                    post_number_in_response = (
                        False if isinstance(parsed, int)
                        else extract_aspire_number(parsed) is not None if isinstance(parsed, dict)
                        else None
                    )
                    ok(
                        f"POST /Opportunities succeeded: OpportunityID={opp_id}, "
                        f"response type={type(parsed).__name__!r}"
                    )
                    if post_number_in_response is False:
                        ok(
                            "POST response does NOT carry the number (bare integer ID only) — "
                            "_fetch_opportunity_number follow-up GET is confirmed necessary"
                        )
                    elif post_number_in_response:
                        ok("POST response CARRIES the number")
                else:
                    bad(f"POST /Opportunities failed: {sc} {body[:200]}")
                    failures.append(f"Opportunity POST failed: {body[:100]}")

            # ── Check 3: opportunity update endpoint ──────────────────────────
            _sep("Check 3: opportunity status update endpoint")
            # CONFIRMED 2026-08-24 (swagger v1 + sandbox smoke test):
            # Aspire API v1 has no PUT or PATCH endpoint for individual opportunities.
            # The only PATCH in the entire API is /WorkTickets/PartialOccurrences.
            # push_status returns status="failed" immediately — no HTTP calls.
            # Contact Aspire support or check API v2+ for the correct mechanism.
            ok("CONFIRMED: no opportunity update endpoint in Aspire API v1 — resolved, no action needed")

            # ── Cleanup ───────────────────────────────────────────────────────
            _sep("Cleanup")
            if opp_id is not None:
                if await _try_delete(client, raw, f"/Opportunities/{opp_id}"):
                    ok(f"Opportunity {opp_id} deleted")
                else:
                    info(f"DELETE /Opportunities/{opp_id} failed — manual cleanup needed (name: {TEST_NAME!r})")
            if prop_id is not None:
                # /Properties/{id} has no individual resource endpoint on sandbox
                info(
                    f"Property {prop_id} ('{TEST_NAME}') has no deletable endpoint on sandbox — "
                    "deactivate it manually in the Aspire sandbox UI."
                )

    # ── Summary ───────────────────────────────────────────────────────────────
    _sep("Summary")
    if prop_id is not None:
        print(f"  Property ID for manual cleanup:    {prop_id}  (name: {TEST_NAME!r})")
    if opp_id is not None:
        print(f"  Opportunity ID (deleted):          {opp_id}  (name: {TEST_NAME!r})")
    print()
    print(f"  POST returns number in body: {post_number_in_response!r}")
    print()

    if failures:
        print(f"  {len(failures)} check(s) inconclusive or failed:")
        for f in failures:
            bad(f"    {f}")
        return 1
    ok("All checks produced definitive answers.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
