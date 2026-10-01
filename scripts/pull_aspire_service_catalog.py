#!/usr/bin/env python3
"""Pull the maintenance service catalog + kit production rates from Aspire for review.

Handoff 54 §1, Steps 1 and 3. READ-ONLY against Aspire (GET only) and never
connects to the CRM database. It writes a review folder, by default
scripts/data/aspire_review/maintenance_catalog_<UTC stamp>/, which is
gitignored: the pull is company/customer data and this repo is mirrored
publicly. The script refuses an output folder inside the repo that git does
not ignore.

What it reads (Aspire REST, OData $filter/$orderby, paged with $top/$skip;
Aspire returns no $count, so a page with no rows ends the walk):

    ServiceTypes               filtered client-side to the maintenance division
    Services                   for those ServiceTypes (ServiceID, ServiceName,
                               DisplayName, ServiceTypeID, SortOrder, Active,
                               ContractService)
    Opportunities              recent WON opportunities (status filter; the
                               division is matched locally because a
                               DivisionID filter times out in Aspire)
    OpportunityServiceGroups   per opportunity: GroupName, OptionalServiceGroup
    OpportunityServices        per opportunity: ServiceID, Occur, ...
    OpportunityServiceKitItems per opportunity: TakeOffItemID, ItemFactor,
                               InvertFactor, ItemCost

What it writes (review folder):

    catalog_review.xlsx        one sheet per CSV below
    categories.csv             our 6 categories vs the live group names
    services.csv               proposed services per category, occurrence
                               default + source, sample counts
    kit_links.csv              proposed service -> kit links
    rates.csv                  per kit: derived rate, source opportunities,
                               baseline, disagreement, action
    unlinked_takeoff_items.csv takeoff items with no service_kits row
    labour_reconcile.csv       labour rows (no TakeOffItemID): ItemCost vs the
                               crew rate; never written anywhere
    seed_maintenance_catalog.sql  services + service_kit_links upserts and
                               NULL-only production_rate backfills. NOT applied
                               by anything: apply by hand after sign-off.
    report.md                  summary and everything that needs a decision
    raw/*.json                 the Aspire responses the review was built from

Rules (Handoff 54 §1 + Carlos 2026-10-01):
    - A maintenance line item is a service (D8). Services are seeded with
      deterministic ids maint-svc-<Aspire ServiceID>.
    - Fertilizer: Shrub Q1-Q4 and Turf Q1-Q4. A required quarter Aspire does
      not have is proposed with aspire_service_id NULL and listed.
    - Peak and off-peak mowing stay separate services.
    - Debris Removal, Round-up and Warranty are Optional Services.
    - Zones are not created (estimators add sections).
    - production_rate comes only from kit items whose InvertFactor is true;
      the rate is ItemFactor. One distinct value across the sample is
      proposed, and only for a kit whose baseline rate is NULL. A kit that
      already has a rate is never changed (the Turf Area control); a
      disagreement, or a kit no opportunity exercises, is listed, never
      guessed. A NULL rate is caught by the save guard.
    - Labour (Maintenance Labor ItemCost) reconciles against
      branch_settings.crew_rate_cents_per_hour and is never written to
      materials or service_kits.
    - service_type values are never changed (LS/IR split, contract narrative).

Usage (from repo root; reads ASPIRE_* from .env like populate_aspire_properties.py):
    venv/bin/python scripts/pull_aspire_service_catalog.py --probe
    venv/bin/python scripts/pull_aspire_service_catalog.py [--opportunities 40]
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import statistics
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from api.aspire_config import ASPIRE_DIVISION_MAP, ASPIRE_OPPORTUNITY_STATUS_WON  # noqa: E402
from api.maintenance_catalog import (  # noqa: E402
    KIT_LINK_BASIS_TAKEOFF,
    MAINTENANCE_CATEGORIES,
    OCCURRENCE_SOURCES,
    kit_id_for_takeoff_item,
    service_id_for_aspire,
)
from scripts.xlsx import write_workbook  # noqa: E402

MAINTENANCE_DIVISION_ID = ASPIRE_DIVISION_MAP["Maintenance: Contract"]  # 1574
DEFAULT_OUT_ROOT = REPO_ROOT / "scripts" / "data" / "aspire_review"
SEED_009 = REPO_ROOT / "sql" / "migrations" / "009_seed_catalog_items.sql"
DEFAULT_PAGE_SIZE = 100
WON_FILTER = "OpportunityStatusName eq 'Won'"
DEFAULT_TIMEOUT_S = 120.0
MAX_PAGES = 500

ENDPOINTS = (
    "ServiceTypes", "Services", "Opportunities", "OpportunityServiceGroups",
    "OpportunityServices", "OpportunityServiceKitItems",
)


# ── field access (Aspire field names vary in case across endpoints) ──────────

def f(row: dict, *names: str, default: Any = None) -> Any:
    """First present, non-None value among names (case-insensitive)."""
    lower = {k.lower(): v for k, v in row.items()}
    for name in names:
        v = lower.get(name.lower())
        if v is not None:
            return v
    return default


def as_int(v: Any) -> Optional[int]:
    try:
        return None if v is None or v == "" else int(v)
    except (TypeError, ValueError):
        return None


def as_float(v: Any) -> Optional[float]:
    try:
        return None if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        return None


def as_bool(v: Any) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes")
    return bool(v)


def norm(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


# ── Aspire transport: paged GETs only ────────────────────────────────────────

def _rows(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("value", "Data", "data", "rows"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


async def fetch_all(
    client,
    endpoint: str,
    *,
    filter_: Optional[str] = None,
    orderby: Optional[str] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    key: Optional[str] = None,
    limit: Optional[int] = None,
    max_pages: int = MAX_PAGES,
) -> list[dict]:
    """GET /<endpoint> page by page with $top/$skip until a page is empty.

    Aspire may return fewer than $top rows on a full page (it caps wide
    tables), so $skip advances by the rows actually returned and only an
    empty page ends the walk. Rows are de-duplicated on `key` (overlapping
    pages repeat rows). `limit` stops early once that many rows are in hand.
    """
    out: list[dict] = []
    seen: set = set()
    skip = 0
    for _ in range(max_pages):
        params: dict[str, Any] = {"$top": page_size, "$skip": skip}
        if filter_:
            params["$filter"] = filter_
        if orderby:
            params["$orderby"] = orderby
        page = _rows(await client.get(f"/{endpoint}", params=params))
        if not page:
            return out
        for row in page:
            k = f(row, key) if key else None
            if k is not None:
                if k in seen:
                    continue
                seen.add(k)
            out.append(row)
        if limit is not None and len(out) >= limit:
            return out[:limit]
        skip += len(page)
    raise RuntimeError(f"{endpoint}: more than {max_pages} pages; narrow the filter")


async def fetch_for_opportunity(client, endpoint: str, opp_id: int, key: str, fallback=None) -> list[dict]:
    """Rows of `endpoint` for one opportunity. If Aspire rejects an
    OpportunityID filter on that endpoint (HTTP 400), `fallback` (an async
    callable) is used instead."""
    from api.aspire_client import AspireHTTPError

    try:
        return await fetch_all(client, endpoint, filter_=f"OpportunityID eq {opp_id}", key=key)
    except AspireHTTPError as exc:
        if exc.status_code != 400 or fallback is None:
            raise
        return await fallback()


@dataclass
class RawPull:
    pulled_at: str
    division_id: int
    service_types: list[dict] = field(default_factory=list)
    services: list[dict] = field(default_factory=list)
    opportunities: list[dict] = field(default_factory=list)
    groups: list[dict] = field(default_factory=list)
    opportunity_services: list[dict] = field(default_factory=list)
    kit_items: list[dict] = field(default_factory=list)


def is_won(opp: dict) -> bool:
    status_id = as_int(f(opp, "OpportunityStatusID"))
    if status_id is not None:
        return status_id == ASPIRE_OPPORTUNITY_STATUS_WON
    return norm(f(opp, "OpportunityStatusName", "OpportunityStatus")) == "won"


async def pull(
    client,
    *,
    division_id: int = MAINTENANCE_DIVISION_ID,
    opportunity_limit: int = 40,
    page_size: int = DEFAULT_PAGE_SIZE,
    log=print,
) -> RawPull:
    raw = RawPull(pulled_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                  division_id=division_id)
    all_types = await fetch_all(client, "ServiceTypes", page_size=page_size, key="ServiceTypeID")
    raw.service_types = [t for t in all_types if as_int(f(t, "DivisionID")) == division_id]
    type_ids = {as_int(f(t, "ServiceTypeID")) for t in raw.service_types}
    all_services = await fetch_all(client, "Services", page_size=page_size, key="ServiceID")
    raw.services = [s for s in all_services if as_int(f(s, "ServiceTypeID")) in type_ids]
    log(f"ServiceTypes in division {division_id}: {len(raw.service_types)}; services: {len(raw.services)}")

    # Recent won opportunities in the division, newest first. Aspire answers a
    # DivisionID filter on /Opportunities with a 504 (probed 2026-10-01), so
    # the server filters on status and the division is matched here.
    won: list[dict] = []
    skip = 0
    for _ in range(MAX_PAGES):
        page = _rows(await client.get("/Opportunities", params={
            "$filter": WON_FILTER, "$orderby": "OpportunityID desc",
            "$top": page_size, "$skip": skip,
        }))
        if not page:
            break
        won.extend(o for o in page
                   if is_won(o) and as_int(f(o, "DivisionID")) == division_id)
        skip += len(page)
        if len(won) >= opportunity_limit:
            break
    raw.opportunities = won[:opportunity_limit]
    log(f"won opportunities sampled: {len(raw.opportunities)}")

    for opp in raw.opportunities:
        opp_id = as_int(f(opp, "OpportunityID"))
        groups = await fetch_for_opportunity(client, "OpportunityServiceGroups", opp_id,
                                             "OpportunityServiceGroupID")
        raw.groups.extend(groups)
        group_ids = [as_int(f(g, "OpportunityServiceGroupID")) for g in groups]

        async def services_by_group(group_ids=group_ids):
            rows: list[dict] = []
            for gid in group_ids:
                rows += await fetch_all(client, "OpportunityServices",
                                        filter_=f"OpportunityServiceGroupID eq {gid}",
                                        key="OpportunityServiceID")
            return rows

        opp_services = await fetch_for_opportunity(client, "OpportunityServices", opp_id,
                                                   "OpportunityServiceID", services_by_group)
        for row in opp_services:
            row.setdefault("OpportunityID", opp_id)
        raw.opportunity_services.extend(opp_services)
        svc_ids = [as_int(f(s, "OpportunityServiceID")) for s in opp_services]

        async def kit_items_by_service(svc_ids=svc_ids):
            rows: list[dict] = []
            for sid in svc_ids:
                rows += await fetch_all(client, "OpportunityServiceKitItems",
                                        filter_=f"OpportunityServiceID eq {sid}",
                                        key="OpportunityServiceKitItemID")
            return rows

        kit_items = await fetch_for_opportunity(client, "OpportunityServiceKitItems", opp_id,
                                                "OpportunityServiceKitItemID", kit_items_by_service)
        for row in kit_items:
            row.setdefault("OpportunityID", opp_id)
        raw.kit_items.extend(kit_items)
    log(f"groups: {len(raw.groups)}; opportunity services: {len(raw.opportunity_services)}; "
        f"kit items: {len(raw.kit_items)}")
    return raw


async def probe(client, page_size: int = 2) -> dict[str, list[str]]:
    """Field names (never values) of each endpoint's first rows."""
    out: dict[str, list[str]] = {}
    for endpoint in ENDPOINTS:
        params: dict[str, Any] = {"$top": page_size, "$skip": 0}
        if endpoint == "Opportunities":
            params["$filter"] = WON_FILTER
        rows = _rows(await client.get(f"/{endpoint}", params=params))
        out[endpoint] = sorted({k for r in rows for k in r})
    return out


# ── baseline kits (the 009 seed, or a DB export) ─────────────────────────────

_SEED_ROW = re.compile(
    r"\('(?P<id>kit-maint-\d+)',\s*'(?P<desc>(?:[^']|'')*)',\s*'(?P<uom>(?:[^']|'')*)',\s*"
    r"(?P<cost>-?\d+),\s*-?\d+,\s*[\d.]+,\s*'maintenance_hours',\s*(?P<rate>NULL|[\d.]+),\s*"
    r"'(?:[^']|'')*',\s*(?P<active>[01]),\s*'(?P<stype>(?:[^']|'')*)'\)"
)


def load_baseline_kits(seed_sql: Path = SEED_009, kits_csv: Optional[Path] = None) -> dict[str, dict]:
    """Maintenance service_kits baseline: id -> description, production_rate, service_type.

    Defaults to the checked-in 009 seed. Pass a CSV exported from the target
    DB (columns id, description, production_rate, service_type) to compare
    against live values instead. Either way the generated SQL only fills a
    NULL production_rate, so a stale baseline cannot overwrite a rate.
    """
    kits: dict[str, dict] = {}
    if kits_csv:
        with open(kits_csv, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                kits[r["id"]] = {
                    "description": r.get("description") or "",
                    "production_rate": as_float(r.get("production_rate")),
                    "service_type": r.get("service_type") or "",
                }
        return kits
    for m in _SEED_ROW.finditer(seed_sql.read_text(encoding="utf-8")):
        kits[m["id"]] = {
            "description": m["desc"].replace("''", "'"),
            "production_rate": None if m["rate"] == "NULL" else float(m["rate"]),
            "service_type": m["stype"].replace("''", "'"),
        }
    return kits


# ── derivation (pure; unit-tested) ───────────────────────────────────────────

_GROUP_TO_CATEGORY = (
    (re.compile(r"\boptional\b"), "optional"),
    (re.compile(r"\bturf\b"), "turf"),
    (re.compile(r"\bbed\b"), "bed_maint"),
    (re.compile(r"\birrigation\b"), "irrigation"),
    (re.compile(r"\bfertili[sz]"), "fertilizer"),
    (re.compile(r"\bpest\b"), "pest_control"),
)

# Fallback when a service never appears in the sampled opportunities:
# ServiceType name -> category.
_TYPE_TO_CATEGORY = (
    (re.compile(r"debris|round.?up|warranty|mulch|annual"), "optional"),
    (re.compile(r"\bmow"), "turf"),
    (re.compile(r"prun|detail"), "bed_maint"),
    (re.compile(r"wet check|irrigat"), "irrigation"),
    (re.compile(r"fertili[sz]"), "fertilizer"),
    (re.compile(r"pest"), "pest_control"),
)

# Carlos 2026-10-01: these service types are optional regardless of group.
_ALWAYS_OPTIONAL = re.compile(r"debris|round.?up|warranty")

_QUARTER = re.compile(r"(?:quarter|q)\s*-?\s*([1-4])\b")
_DO_NOT_USE = re.compile(r"do\s+not\s+use", re.I)


def category_for_group(group_name: Any, optional_flag: bool = False) -> Optional[str]:
    if optional_flag:
        return "optional"
    name = norm(group_name)
    for pattern, code in _GROUP_TO_CATEGORY:
        if pattern.search(name):
            return code
    return None


def category_for_type(type_name: Any) -> Optional[str]:
    name = norm(type_name)
    for pattern, code in _TYPE_TO_CATEGORY:
        if pattern.search(name):
            return code
    return None


def fertilizer_slot(name: Any) -> Optional[tuple[str, int]]:
    """('shrub'|'turf', quarter) for a quarterly fertilizer service name."""
    n = norm(name)
    if "fertil" not in n:
        return None
    q = _QUARTER.search(n)
    if not q:
        return None
    if "shrub" in n or "bed" in n:
        return ("shrub", int(q.group(1)))
    if "turf" in n:
        return ("turf", int(q.group(1)))
    return None


def occurrence_source_for(category: str, type_name: Any, name: Any) -> tuple[Optional[str], str]:
    """(occurrence_source, note). Quarterly fertilizer and peak/off-peak
    mowing take no 064 count (one visit per quarter; the yearly mowing total
    cannot be split between peak and off-peak)."""
    n, t = norm(name), norm(type_name)
    if fertilizer_slot(name):
        return None, "quarterly service: one visit, default_occurrences"
    if category == "turf" and ("peak" in n):
        return None, "peak/off-peak: yearly mowing count cannot be split; default from Aspire median"
    if category == "turf" and "mow" in (n + " " + t):
        return "mowing_occurrences", ""
    if category == "bed_maint" and "prun" in (n + " " + t):
        return "pruning_occurrences", ""
    if category == "irrigation":
        return "irrigation_occurrences", ""
    if category == "pest_control":
        return "ipm_occurrences", ""
    if category == "fertilizer":
        if "shrub" in n or "bed" in n:
            return "shrub_fert_occurrences", ""
        if "turf" in n:
            return "turf_fert_occurrences", ""
    return None, ""


@dataclass
class Plan:
    pulled_at: str
    sample_opportunities: int
    categories: list[dict]
    services: list[dict]
    links: list[dict]
    rates: list[dict]
    unlinked_takeoff_items: list[dict]
    labour: list[dict]
    unassigned_services: list[dict]
    unmapped_groups: list[dict]
    notes: list[str]


def derive(raw: RawPull, kits: dict[str, dict], min_opportunities: int = 1) -> Plan:
    """`min_opportunities`: a division service must appear in at least this many
    sampled won opportunities to be proposed (Aspire keeps hundreds of
    one-off services); Fertilizer quarters and the services Carlos named
    optional are always kept. 0 proposes every active service."""
    notes: list[str] = []
    types = {as_int(f(t, "ServiceTypeID")): t for t in raw.service_types}
    groups = {as_int(f(g, "OpportunityServiceGroupID")): g for g in raw.groups}

    # Group vocabulary.
    group_stats: dict[str, dict] = {}
    for g in raw.groups:
        name = re.sub(r"\s+", " ", str(f(g, "GroupName", "OpportunityServiceGroupName", default=""))).strip()
        st = group_stats.setdefault(norm(name), {"names": Counter(), "opps": set(), "optional": 0, "rows": 0})
        st["names"][name] += 1
        st["opps"].add(as_int(f(g, "OpportunityID")))
        st["rows"] += 1
        st["optional"] += 1 if as_bool(f(g, "OptionalServiceGroup")) else 0

    categories = []
    for code, (cat_id, cat_name, is_opt) in MAINTENANCE_CATEGORIES.items():
        matches = [k for k, st in group_stats.items()
                   if category_for_group(k, st["optional"] > st["rows"] / 2) == code]
        live_names = sorted({n for k in matches for n in group_stats[k]["names"]})
        categories.append({
            "id": cat_id, "code": code, "name": cat_name, "is_optional": is_opt,
            "live_group_names": "; ".join(live_names),
            "opportunities_with_group": len({o for k in matches for o in group_stats[k]["opps"]}),
            "name_matches_live": cat_name in live_names if live_names else None,
        })
    unmapped_groups = [
        {"group_name": st["names"].most_common(1)[0][0], "opportunities": len(st["opps"]),
         "optional_rows": st["optional"], "rows": st["rows"]}
        for k, st in sorted(group_stats.items())
        if category_for_group(k, st["optional"] > st["rows"] / 2) is None
    ]

    # Per-service sample stats.
    svc_cat_votes: dict[int, Counter] = defaultdict(Counter)
    svc_occ: dict[int, list[float]] = defaultdict(list)
    svc_opps: dict[int, set] = defaultdict(set)
    opp_service_to_service: dict[int, int] = {}
    # A line in an unmapped group (most live groups are just "Maintenance
    # Contract") votes for its service type's category, so a few optional
    # appearances cannot outvote the service's everyday use.
    type_of_service = {as_int(f(s, "ServiceID")): f(types.get(as_int(f(s, "ServiceTypeID")), {}),
                                                      "ServiceTypeName", "Name", default="")
                       for s in raw.services}
    for os_row in raw.opportunity_services:
        sid = as_int(f(os_row, "ServiceID"))
        if sid is None:
            continue
        opp_service_to_service[as_int(f(os_row, "OpportunityServiceID"))] = sid
        g = groups.get(as_int(f(os_row, "OpportunityServiceGroupID")))
        if g is not None:
            cat = category_for_group(f(g, "GroupName", "OpportunityServiceGroupName"),
                                     as_bool(f(g, "OptionalServiceGroup")))
            cat = cat or category_for_type(type_of_service.get(sid))
            if cat:
                svc_cat_votes[sid][cat] += 1
        occ = as_float(f(os_row, "Occur", "Occurrences"))
        if occ is not None:
            svc_occ[sid].append(occ)
        svc_opps[sid].add(as_int(f(os_row, "OpportunityID")))

    services: list[dict] = []
    unassigned: list[dict] = []
    for s in raw.services:
        sid = as_int(f(s, "ServiceID"))
        name = re.sub(r"\s+", " ", str(f(s, "ServiceName", "Name", default=""))).strip()
        display = re.sub(r"\s+", " ", str(f(s, "DisplayName", default="") or name)).strip()
        t = types.get(as_int(f(s, "ServiceTypeID")), {})
        type_name = f(t, "ServiceTypeName", "Name", default="")
        active = as_bool(f(s, "Active", default=True))
        if _DO_NOT_USE.search(name) or not active:
            unassigned.append({"aspire_service_id": sid, "name": name, "service_type": type_name,
                               "reason": "DO NOT USE" if _DO_NOT_USE.search(name) else "inactive in Aspire"})
            continue
        votes = svc_cat_votes.get(sid)
        if votes:
            category, source = votes.most_common(1)[0][0], "sampled groups"
        else:
            category, source = category_for_type(type_name), "service type name"
        if _ALWAYS_OPTIONAL.search(norm(type_name)) or _ALWAYS_OPTIONAL.search(norm(name)):
            category, source = "optional", "Carlos 2026-10-01: optional"
        if category is None:
            unassigned.append({"aspire_service_id": sid, "name": name, "service_type": type_name,
                               "reason": "no sampled group and no type mapping"})
            continue
        # Decision-named services: Fertilizer quarters, the always-optional
        # ones, and peak/off-peak mowing (kept as separate services).
        named = (bool(fertilizer_slot(name)) or bool(_ALWAYS_OPTIONAL.search(norm(name)))
                 or (category == "turf" and "peak" in norm(name)))
        if len(svc_opps.get(sid, set())) < min_opportunities and not named:
            unassigned.append({"aspire_service_id": sid, "name": name, "service_type": type_name,
                               "reason": f"in fewer than {min_opportunities} sampled won opportunities"})
            continue
        occ_values = svc_occ.get(sid, [])
        default_occ = round(statistics.median(occ_values)) if occ_values else None
        if default_occ is None and fertilizer_slot(name):
            default_occ = 1
        occ_source, occ_note = occurrence_source_for(category, type_name, name)
        services.append({
            "id": service_id_for_aspire(sid),
            "aspire_service_id": sid,
            "category_code": category,
            "service_category_id": MAINTENANCE_CATEGORIES[category][0],
            "name": name,
            "display_name": display,
            "service_type": type_name,
            "aspire_sort_order": as_int(f(s, "SortOrder")),
            "contract_service": f(s, "ContractService"),
            "default_occurrences": default_occ,
            "occurrence_source": occ_source,
            "occurrence_note": occ_note,
            "sample_opportunities": len(svc_opps.get(sid, set())),
            "sample_lines": len(occ_values),
            "occur_values": ", ".join(str(v).rstrip("0").rstrip(".") for v in sorted(set(occ_values))),
            "category_source": source,
            "flag": "",
        })

    # Carlos: Fertilizer Shrub Q1-Q4 and Turf Q1-Q4.
    slots = {fertilizer_slot(s["name"]): s for s in services if fertilizer_slot(s["name"])}
    for kind in ("shrub", "turf"):
        for q in (1, 2, 3, 4):
            if (kind, q) in slots:
                s = slots[(kind, q)]
                if s["category_code"] != "fertilizer":
                    s["flag"] = f"moved to Fertilizer (was {s['category_code']})"
                    s["category_code"], s["service_category_id"] = "fertilizer", MAINTENANCE_CATEGORIES["fertilizer"][0]
                continue
            label = f"Fertilizer {kind.title()} - Quarter {q}"
            services.append({
                "id": f"maint-svc-fert-{kind}-q{q}", "aspire_service_id": None,
                "category_code": "fertilizer", "service_category_id": MAINTENANCE_CATEGORIES["fertilizer"][0],
                "name": label, "display_name": label, "service_type": "", "aspire_sort_order": None,
                "contract_service": None, "default_occurrences": 1, "occurrence_source": None,
                "occurrence_note": "quarterly service: one visit", "sample_opportunities": 0,
                "sample_lines": 0, "occur_values": "", "category_source": "Carlos 2026-10-01",
                "flag": "REQUIRED by decision but not in the Aspire catalog: created without an "
                        "Aspire id; kits copied from the same-kind quarters",
            })
            notes.append(f"{label} is not an Aspire service; proposed without aspire_service_id.")

    # Order within category: sample frequency, then Aspire SortOrder, then name.
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for s in services:
        by_cat[s["category_code"]].append(s)
    ordered: list[dict] = []
    for code in MAINTENANCE_CATEGORIES:
        rows = sorted(by_cat.get(code, []), key=lambda s: (
            -s["sample_opportunities"],
            s["aspire_sort_order"] if s["aspire_sort_order"] is not None else 10**9,
            s["name"].lower()))
        for i, s in enumerate(rows, start=1):
            s["sort_order"] = i * 10
        ordered.extend(rows)

    # Kit links + rates from kit items.
    link_counts: dict[str, Counter] = defaultdict(Counter)
    rate_obs: dict[str, dict[float, set]] = defaultdict(lambda: defaultdict(set))
    non_inverted: dict[str, Counter] = defaultdict(Counter)
    unlinked: dict[int, dict] = {}
    labour: dict[tuple, dict] = {}
    svc_ids = {s["aspire_service_id"] for s in ordered if s["aspire_service_id"] is not None}
    for item in raw.kit_items:
        opp_id = as_int(f(item, "OpportunityID"))
        takeoff = as_int(f(item, "TakeOffItemID", "TakeoffItemID"))
        sid = opp_service_to_service.get(as_int(f(item, "OpportunityServiceID")))
        if takeoff is None:
            name = str(f(item, "ItemName", "CatalogItemName", "Name", default=""))
            cost = as_float(f(item, "ItemCost"))
            key = (norm(name), cost)
            row = labour.setdefault(key, {"item_name": name, "item_cost": cost,
                                          "item_type": f(item, "ItemType"), "lines": 0, "opportunities": set()})
            row["lines"] += 1
            row["opportunities"].add(opp_id)
            continue
        kit_id = kit_id_for_takeoff_item(takeoff)
        if kit_id not in kits:
            u = unlinked.setdefault(takeoff, {"takeoff_item_id": takeoff,
                                              "item_name": f(item, "ItemName", "TakeOffItemName", default=""),
                                              "lines": 0, "services": set()})
            u["lines"] += 1
            if sid:
                u["services"].add(sid)
            continue
        if sid in svc_ids:
            link_counts[service_id_for_aspire(sid)][kit_id] += 1
        factor = as_float(f(item, "ItemFactor"))
        if factor and factor > 0:
            if as_bool(f(item, "InvertFactor")):
                rate_obs[kit_id][round(factor, 4)].add(opp_id)
            else:
                non_inverted[kit_id][round(factor, 4)] += 1

    # Required quarters with no Aspire service copy the same-kind quarters' kits.
    for s in ordered:
        if s["aspire_service_id"] is None and s["id"].startswith("maint-svc-fert-"):
            kind = s["id"].split("-")[3]
            for other in ordered:
                slot = fertilizer_slot(other["name"])
                if other is not s and slot and slot[0] == kind and other["aspire_service_id"] is not None:
                    link_counts[s["id"]].update(link_counts.get(other["id"], Counter()))
            if not link_counts.get(s["id"]):
                # No live quarter at all (Aspire's quarter services are DO NOT
                # USE): take the kits of the plain same-kind fertilizer service.
                for other in ordered:
                    n = norm(other["name"])
                    if (other["category_code"] == "fertilizer" and other["aspire_service_id"] is not None
                            and kind in n and "additional" not in n):
                        link_counts[s["id"]].update(link_counts.get(other["id"], Counter()))
                        s["flag"] += f"; kits from {other['name']}"

    links = []
    for service_id, counts in sorted(link_counts.items()):
        for i, (kit_id, n) in enumerate(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])), start=1):
            links.append({"service_id": service_id, "service_kit_id": kit_id,
                          "kit_description": kits[kit_id]["description"], "basis": KIT_LINK_BASIS_TAKEOFF,
                          "sort_order": i * 10, "is_primary": i == 1, "sample_lines": n})

    rates = []
    for kit_id, kit in sorted(kits.items()):
        obs = rate_obs.get(kit_id, {})
        baseline = kit["production_rate"]
        distinct = sorted(obs)
        opps = sorted({o for v in obs.values() for o in v if o is not None})
        row = {"service_kit_id": kit_id, "description": kit["description"],
               "service_type": kit["service_type"], "baseline_rate": baseline,
               "derived_rates": ", ".join(f"{v:g}" for v in distinct),
               "source_opportunities": ", ".join(str(o) for o in opps),
               "non_inverted_factors": ", ".join(f"{v:g}" for v in sorted(non_inverted.get(kit_id, {}))),
               "proposed_rate": None, "action": ""}
        if baseline is not None:
            if not distinct or distinct == [round(baseline, 4)]:
                row["action"] = "unchanged (baseline kept)"
            else:
                row["action"] = "unchanged: Aspire sample disagrees with baseline, listed for review"
        elif not distinct:
            row["action"] = "stays NULL: no sampled opportunity exercises this kit"
        elif len(distinct) > 1:
            row["action"] = "stays NULL: sampled rates disagree, listed for review"
        else:
            row["proposed_rate"] = distinct[0]
            row["action"] = "backfill NULL rate"
        rates.append(row)

    unlinked_rows = [{**u, "services": ", ".join(str(s) for s in sorted(u["services"]))}
                     for u in sorted(unlinked.values(), key=lambda u: -u["lines"])]
    labour_rows = [{**l, "opportunities": len(l["opportunities"]),
                    "note": "reconcile against branch_settings.crew_rate_cents_per_hour; never written"}
                   for l in sorted(labour.values(), key=lambda l: -l["lines"])]
    for cat in categories:
        if cat["name_matches_live"] is False:
            notes.append(f"Category {cat['name']!r}: live Aspire group name(s) are "
                         f"{cat['live_group_names']!r}; aspire_service_group_name may need updating.")
    return Plan(raw.pulled_at, len(raw.opportunities), categories, ordered, links, rates,
                unlinked_rows, labour_rows, unassigned, unmapped_groups, notes)


# ── SQL (for review; never executed here) ────────────────────────────────────

def sql_str(v: Any) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v) if isinstance(v, float) else str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def render_sql(plan: Plan) -> str:
    out = [
        "-- Maintenance service catalog seed (Handoff 54 §1) — GENERATED FOR REVIEW.",
        f"-- Pulled from Aspire {plan.pulled_at}; {plan.sample_opportunities} won opportunities sampled.",
        "-- NOT applied by any runner. Apply by hand only after the review is signed off,",
        "-- against a database where migration 075 has run.",
        "-- Writes services and service_kit_links (maintenance only) and fills NULL",
        "-- service_kits.production_rate values. Never changes a rate that is set, a",
        "-- service_type, a kit id, or any materials table.",
        "START TRANSACTION;",
        "",
    ]
    for s in plan.services:
        aid = s["aspire_service_id"]
        cols = [s["id"], s["service_category_id"], s["name"], s["display_name"], s["sort_order"],
                s["default_occurrences"], s["occurrence_source"], aid, 1]
        if s["occurrence_source"] is not None:
            assert s["occurrence_source"] in OCCURRENCE_SOURCES
        guard = (f"WHERE NOT EXISTS (SELECT 1 FROM services x WHERE x.aspire_service_id = {aid} "
                 f"AND x.id <> {sql_str(s['id'])})" if aid is not None else "")
        out.append(
            "INSERT INTO services (id, service_category_id, name, display_name, sort_order, "
            "default_occurrences, occurrence_source, aspire_service_id, active)\n"
            f"SELECT {', '.join(sql_str(c) for c in cols)} FROM DUAL {guard}\n"
            "ON DUPLICATE KEY UPDATE service_category_id = VALUES(service_category_id), "
            "name = VALUES(name), display_name = VALUES(display_name), sort_order = VALUES(sort_order), "
            "default_occurrences = VALUES(default_occurrences), "
            "occurrence_source = VALUES(occurrence_source), active = VALUES(active);"
        )
    out.append("")
    for l in plan.links:
        out.append(
            "INSERT INTO service_kit_links (service_id, service_kit_id, basis, sort_order) VALUES "
            f"({sql_str(l['service_id'])}, {sql_str(l['service_kit_id'])}, {sql_str(l['basis'])}, "
            f"{l['sort_order']}) ON DUPLICATE KEY UPDATE basis = VALUES(basis), sort_order = VALUES(sort_order);"
        )
    out.append("")
    for r in plan.rates:
        if r["proposed_rate"] is None:
            continue
        out.append(
            f"UPDATE service_kits SET production_rate = {r['proposed_rate']!r} "
            f"WHERE id = {sql_str(r['service_kit_id'])} AND kit_type = 'maintenance_hours' "
            "AND production_rate IS NULL;"
        )
    out += ["", "COMMIT;", ""]
    return "\n".join(out)


# ── review folder ────────────────────────────────────────────────────────────

_SHEETS = (
    ("categories", "Categories"),
    ("services", "Services"),
    ("links", "Kit Links"),
    ("rates", "Rates"),
    ("unlinked_takeoff_items", "Unlinked Takeoff Items"),
    ("labour", "Labour Reconcile"),
    ("unassigned_services", "Not Seeded"),
    ("unmapped_groups", "Unmapped Groups"),
)
_CSV_NAMES = {"links": "kit_links", "labour": "labour_reconcile"}


def _table(rows: list[dict]) -> list[list]:
    if not rows:
        return [["(none)"]]
    header = list(rows[0])
    return [header] + [[r.get(h) for h in header] for r in rows]


def ensure_ignored(out_dir: Path) -> None:
    """Refuse an output folder inside the repo that git would track."""
    try:
        out_dir.resolve().relative_to(REPO_ROOT)
    except ValueError:
        return  # outside the repo
    probe = out_dir / "catalog_review.xlsx"
    res = subprocess.run(["git", "-C", str(REPO_ROOT), "check-ignore", "-q", str(probe)],
                         capture_output=True)
    if res.returncode != 0:
        raise SystemExit(f"Refusing to write Aspire data to {out_dir}: not gitignored "
                         "(this repo is mirrored publicly). Use scripts/data/aspire_review/.")


def write_review(plan: Plan, raw: RawPull, out_dir: Path) -> list[Path]:
    ensure_ignored(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    sheets = {}
    for attr, title in _SHEETS:
        rows = getattr(plan, attr)
        sheets[title] = _table(rows)
        path = out_dir / f"{_CSV_NAMES.get(attr, attr)}.csv"
        with open(path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerows(_table(rows))
        written.append(path)
    xlsx = out_dir / "catalog_review.xlsx"
    write_workbook(xlsx, sheets)
    written.append(xlsx)
    sql = out_dir / "seed_maintenance_catalog.sql"
    sql.write_text(render_sql(plan), encoding="utf-8")
    written.append(sql)
    report = out_dir / "report.md"
    report.write_text(render_report(plan), encoding="utf-8")
    written.append(report)
    raw_dir = out_dir / "raw"
    raw_dir.mkdir(exist_ok=True)
    for name in ("service_types", "services", "opportunities", "groups",
                 "opportunity_services", "kit_items"):
        p = raw_dir / f"{name}.json"
        p.write_text(json.dumps(getattr(raw, name), indent=1, default=str), encoding="utf-8")
        written.append(p)
    return written


def render_report(plan: Plan) -> str:
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for s in plan.services:
        by_cat[s["category_code"]].append(s)
    lines = [
        "# Maintenance service catalog — review (Handoff 54 §1)",
        "",
        f"Pulled {plan.pulled_at} from Aspire (read-only). Sample: {plan.sample_opportunities} "
        "recent won Maintenance: Contract opportunities. All counts are sample counts.",
        "Nothing has been written to any database. `seed_maintenance_catalog.sql` applies the "
        "proposal after sign-off.",
        "",
        "## Catalog (services per category, with occurrence defaults)",
    ]
    for code, (_cid, name, is_opt) in MAINTENANCE_CATEGORIES.items():
        lines.append(f"\n### {name}{' (optional — added one service at a time)' if is_opt else ''}")
        rows = by_cat.get(code, [])
        if not rows:
            lines.append("- (no services)")
        for s in rows:
            occ = s["occurrence_source"] or (f"default {s['default_occurrences']}"
                                             if s["default_occurrences"] is not None else "default —")
            flag = f" — **{s['flag']}**" if s["flag"] else ""
            lines.append(f"- {s['display_name']} (Aspire {s['aspire_service_id'] or '—'}; occurrences: "
                         f"{occ}; in {s['sample_opportunities']} sampled opps){flag}")
    backfill = [r for r in plan.rates if r["proposed_rate"] is not None]
    disagree = [r for r in plan.rates if "disagree" in r["action"]]
    unexercised = [r for r in plan.rates if r["action"].startswith("stays NULL: no sampled")]
    lines += [
        "",
        "## Rates",
        f"- Proposed backfills (NULL → rate): {len(backfill)}",
        f"- Disagreements (left as is, need a decision): {len(disagree)}",
        f"- Kits no sampled opportunity exercises (stay NULL): {len(unexercised)}",
        "- Kits that already have a rate are never changed (Turf Area control).",
        "",
        "## Needs a decision",
    ]
    lines += [f"- {n}" for n in plan.notes] or ["- (none)"]
    for r in disagree:
        lines.append(f"- {r['service_kit_id']} {r['description']}: baseline {r['baseline_rate']}, "
                     f"sampled {r['derived_rates']}")
    for s in plan.services:
        if s["occurrence_note"].startswith("peak"):
            lines.append(f"- {s['display_name']}: {s['occurrence_note']}")
    if plan.unassigned_services:
        lines.append(f"- {len(plan.unassigned_services)} division services not seeded (see Not Seeded).")
    if plan.unmapped_groups:
        lines.append(f"- {len(plan.unmapped_groups)} live group names map to no category (see Unmapped Groups).")
    if plan.unlinked_takeoff_items:
        lines.append(f"- {len(plan.unlinked_takeoff_items)} takeoff items have no service_kits row "
                     "(see Unlinked Takeoff Items); their services link only to known kits.")
    return "\n".join(lines) + "\n"


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--probe", action="store_true",
                    help="print each endpoint's field names (no values) and exit")
    ap.add_argument("--opportunities", type=int, default=40,
                    help="recent won maintenance opportunities to sample (default 40)")
    ap.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    ap.add_argument("--min-opportunities", type=int, default=1,
                    help="propose only services used in at least this many sampled won "
                         "opportunities (0 = every active division service)")
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S,
                    help="seconds per Aspire request (wide tables are slow)")
    ap.add_argument("--out", type=Path, default=None,
                    help="review folder (default scripts/data/aspire_review/maintenance_catalog_<stamp>)")
    ap.add_argument("--kits-csv", type=Path, default=None,
                    help="service_kits export (id, description, production_rate, service_type) to "
                         "compare against instead of the 009 seed")
    args = ap.parse_args(argv)

    from dotenv import load_dotenv
    load_dotenv(REPO_ROOT / ".env")
    from api.aspire_client import AspireClient

    async def run() -> int:
        import httpx
        async with AspireClient(client=httpx.AsyncClient(timeout=args.timeout)) as client:
            if args.probe:
                for endpoint, fields in (await probe(client)).items():
                    print(f"{endpoint}: {', '.join(fields)}")
                return 0
            out = args.out or DEFAULT_OUT_ROOT / (
                "maintenance_catalog_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
            ensure_ignored(out)
            raw = await pull(client, opportunity_limit=args.opportunities, page_size=args.page_size)
            plan = derive(raw, load_baseline_kits(kits_csv=args.kits_csv),
                          min_opportunities=args.min_opportunities)
            for p in write_review(plan, raw, out):
                print(p)
            print(f"services: {len(plan.services)}; links: {len(plan.links)}; "
                  f"rate backfills: {sum(1 for r in plan.rates if r['proposed_rate'] is not None)}")
            return 0

    return asyncio.run(run())


if __name__ == "__main__":
    raise SystemExit(main())
