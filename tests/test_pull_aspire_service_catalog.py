"""scripts/pull_aspire_service_catalog.py (Handoff 54 §1, Steps 1 and 3).

Everything runs against a fake Aspire client serving synthetic rows shaped
like the REST endpoints; no network, no database. The live pull is a separate,
reviewed run whose output stays in the gitignored scripts/data/aspire_review/.
"""
from __future__ import annotations

import asyncio
import re
import sys
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from api.aspire_client import AspireHTTPError  # noqa: E402
from scripts import pull_aspire_service_catalog as P  # noqa: E402
from scripts.xlsx import sheet_targets  # noqa: E402

DIV = P.MAINTENANCE_DIVISION_ID
WON = P.ASPIRE_OPPORTUNITY_STATUS_WON


# ── fake Aspire ──────────────────────────────────────────────────────────────

def _odata_filter(rows: list[dict], expr: str | None) -> list[dict]:
    if not expr:
        return rows
    out = rows
    for clause in expr.split(" and "):
        m = re.fullmatch(r"(\w+) eq (\d+)", clause.strip())
        assert m, f"fake cannot evaluate {clause!r}"
        out = [r for r in out if r.get(m[1]) == int(m[2])]
    return out


class FakeAspire:
    """GET-only. `cap` caps rows per page below $top (Aspire caps wide tables);
    `reject` lists endpoints that 400 on an OpportunityID filter."""

    def __init__(self, data: dict[str, list[dict]], cap: int | None = None, reject=()):
        self.data, self.cap, self.reject = data, cap, set(reject)
        self.calls: list[tuple[str, dict]] = []

    async def get(self, path: str, params=None):
        params = dict(params or {})
        self.calls.append((path, params))
        endpoint = path.strip("/")
        flt = params.get("$filter")
        if endpoint in self.reject and flt and flt.startswith("OpportunityID"):
            raise AspireHTTPError(400, "filter not supported")
        rows = _odata_filter(self.data.get(endpoint, []), flt)
        if params.get("$orderby") == "OpportunityID desc":
            rows = sorted(rows, key=lambda r: -r["OpportunityID"])
        top = params.get("$top", 100)
        if self.cap:
            top = min(top, self.cap)
        skip = params.get("$skip", 0)
        return rows[skip: skip + top]

    async def post(self, *a, **k):  # pragma: no cover - must never be called
        raise AssertionError("pull script must be read-only")

    patch = put = post


def _svc(sid, name, type_id, active=True, display=None):
    return {"ServiceID": sid, "ServiceName": name, "DisplayName": display or name,
            "ServiceTypeID": type_id, "SortOrder": sid % 7, "Active": active, "ContractService": True}


SERVICE_TYPES = [
    {"ServiceTypeID": 1, "ServiceTypeName": "Mow", "DivisionID": DIV},
    {"ServiceTypeID": 2, "ServiceTypeName": "Pruning", "DivisionID": DIV},
    {"ServiceTypeID": 3, "ServiceTypeName": "Wet Check", "DivisionID": DIV},
    {"ServiceTypeID": 4, "ServiceTypeName": "Fertilize", "DivisionID": DIV},
    {"ServiceTypeID": 5, "ServiceTypeName": "Pest Control", "DivisionID": DIV},
    {"ServiceTypeID": 6, "ServiceTypeName": "Debris Removal", "DivisionID": DIV},
    {"ServiceTypeID": 7, "ServiceTypeName": "Round-up", "DivisionID": DIV},
    {"ServiceTypeID": 8, "ServiceTypeName": "Warranty", "DivisionID": DIV},
    {"ServiceTypeID": 9, "ServiceTypeName": "Mulch", "DivisionID": DIV},
    {"ServiceTypeID": 99, "ServiceTypeName": "IN: Irrigation", "DivisionID": 1577},
]
SERVICES = [
    _svc(101, "MC: Mowing Service", 1),
    _svc(102, "MC: PEAK Mowing", 1),
    _svc(103, "MC: OFF-PEAK Mowing", 1),
    _svc(201, "MC: Pruning", 2),
    _svc(301, "MC: Wet Check", 3),
    _svc(401, "Fertilizer Shrub - Quarter 1", 4),
    _svc(402, "Fertilizer Shrub - Quarter 2", 4),
    _svc(404, "Fertilizer Shrub - Quarter 4", 4),
    _svc(411, "Fertilizer Turf - Quarter 1", 4),
    _svc(412, "Fertilizer Turf - Quarter 2", 4),
    _svc(413, "Fertilizer Turf - Quarter 3", 4),
    _svc(414, "Fertilizer Turf - Quarter 4", 4),
    _svc(501, "Fungus and Turf Weed Control", 5),
    _svc(502, "Insect and Disease Control", 5),
    _svc(601, "Debris Removal", 6),
    _svc(701, "Round-up", 7),
    _svc(801, "Warranty", 8),
    _svc(901, "Mulch", 9),
    _svc(902, "Mulch DO NOT USE", 9),
    _svc(903, "Old Mulch", 9, active=False),
    _svc(990, "IN: Irrigation Install", 99),  # install division: never pulled
]

GROUP_NAMES = {1: "Turf", 2: "Bed Maint", 3: "Irrigation", 4: "Fertilizer",
               5: "Pest Control", 9: "Optional Services"}
SERVICE_GROUP = {101: 1, 201: 2, 301: 3, 401: 4, 402: 4, 404: 4, 411: 4, 412: 4, 413: 4,
                 414: 4, 501: 5, 502: 5, 901: 9}


def build_data(n_opps: int = 3) -> dict[str, list[dict]]:
    opps, groups, osvcs, items = [], [], [], []
    gid, osid, kid = 1000, 5000, 9000
    for i in range(n_opps):
        opp_id = 655100 + i
        opps.append({"OpportunityID": opp_id, "DivisionID": DIV, "OpportunityStatusID": WON})
        gids = {}
        for g, name in GROUP_NAMES.items():
            gid += 1
            gids[g] = gid
            groups.append({"OpportunityServiceGroupID": gid, "OpportunityID": opp_id,
                           "GroupName": name, "OptionalServiceGroup": name == "Optional Services"})
        for sid, g in SERVICE_GROUP.items():
            osid += 1
            occ = {101: 40, 201: 6, 501: 6, 502: 6, 301: 12}.get(sid, 1)
            osvcs.append({"OpportunityServiceID": osid, "OpportunityServiceGroupID": gids[g],
                          "OpportunityID": opp_id, "ServiceID": sid, "Occur": occ})
            def item(takeoff, factor, invert, cost=17.5, name="x"):
                nonlocal kid
                kid += 1
                items.append({"OpportunityServiceKitItemID": kid, "OpportunityServiceID": osid,
                              "OpportunityID": opp_id, "TakeOffItemID": takeoff,
                              "ItemFactor": factor, "InvertFactor": invert, "ItemCost": cost,
                              "ItemName": name})
            if sid == 101:
                item(3422, 70000 if i == 0 else 67650, True)   # disagrees with the 67650 baseline once
                item(3425, 3460, True)
                item(None, None, False, 17.5, "Maintenance Labor")
            if sid == 201:
                item(3434, 1500, True)                          # Prune Medium: NULL baseline, one value
                item(3433, 900 + i, True)                       # Prune Hard: values disagree
            if sid in (401, 402, 404):
                item(3439, 20000, True)                         # Bed Area Fertilization
            if sid in (411, 412, 413, 414):
                item(3440, 30000, False)                        # not inverted: never a rate
            if sid in (501, 502):
                item(3440, 30000, False)
                item(77777, 5, True)                            # no service_kits row
    opps.append({"OpportunityID": 655000, "DivisionID": DIV, "OpportunityStatusID": 1659})  # lost
    return {"ServiceTypes": SERVICE_TYPES, "Services": SERVICES, "Opportunities": opps,
            "OpportunityServiceGroups": groups, "OpportunityServices": osvcs,
            "OpportunityServiceKitItems": items}


def _pull(client, **kw):
    return asyncio.run(P.pull(client, log=lambda *_: None, **kw))


@pytest.fixture(scope="module")
def kits():
    return P.load_baseline_kits()


@pytest.fixture(scope="module")
def plan(kits):
    return P.derive(_pull(FakeAspire(build_data())), kits)


def _services(plan, code):
    return [s for s in plan.services if s["category_code"] == code]


# ── transport ────────────────────────────────────────────────────────────────

def test_fetch_all_pages_with_skip_until_an_empty_page():
    rows = [{"ServiceID": i} for i in range(23)]
    client = FakeAspire({"Services": rows})
    got = asyncio.run(P.fetch_all(client, "Services", page_size=10, key="ServiceID"))
    assert [r["ServiceID"] for r in got] == list(range(23))
    assert [c[1]["$skip"] for c in client.calls] == [0, 10, 20, 23]
    assert all(c[1]["$top"] == 10 for c in client.calls)


def test_fetch_all_advances_by_rows_returned_when_aspire_caps_the_page():
    client = FakeAspire({"Services": [{"ServiceID": i} for i in range(9)]}, cap=4)
    got = asyncio.run(P.fetch_all(client, "Services", page_size=200, key="ServiceID"))
    assert len(got) == 9
    assert [c[1]["$skip"] for c in client.calls] == [0, 4, 8, 9]


def test_fetch_all_dedupes_and_respects_limit():
    client = FakeAspire({"Services": [{"ServiceID": 1}, {"ServiceID": 1}, {"ServiceID": 2}]})
    assert len(asyncio.run(P.fetch_all(client, "Services", key="ServiceID"))) == 2
    assert len(asyncio.run(P.fetch_all(client, "Services", limit=1))) == 1


def test_pull_is_get_only_and_samples_won_maintenance_opportunities():
    client = FakeAspire(build_data(n_opps=4))
    raw = _pull(client, opportunity_limit=3)
    assert all(path.startswith("/") for path, _ in client.calls)
    assert [o["OpportunityID"] for o in raw.opportunities] == [655103, 655102, 655101]
    assert {s["ServiceID"] for s in raw.services} == {s["ServiceID"] for s in SERVICES} - {990}
    opp_calls = [p for path, p in client.calls if path == "/Opportunities"]
    assert opp_calls[0]["$filter"] == f"DivisionID eq {DIV}"


def test_pull_falls_back_when_an_endpoint_rejects_the_opportunity_filter():
    data = build_data(n_opps=2)
    direct = _pull(FakeAspire(data))
    client = FakeAspire(data, reject={"OpportunityServices", "OpportunityServiceKitItems"})
    fallback = _pull(client)
    assert len(fallback.opportunity_services) == len(direct.opportunity_services)
    assert len(fallback.kit_items) == len(direct.kit_items)
    assert any(p.get("$filter", "").startswith("OpportunityServiceGroupID eq") for _, p in client.calls)
    assert any(p.get("$filter", "").startswith("OpportunityServiceID eq") for _, p in client.calls)


# ── baseline ─────────────────────────────────────────────────────────────────

def test_baseline_reads_the_48_seeded_maintenance_kits(kits):
    assert len(kits) == 48
    assert kits["kit-maint-3422"]["production_rate"] == 67650.0
    assert kits["kit-maint-3434"]["production_rate"] is None
    assert kits["kit-maint-3422"]["service_type"] == "Turf Area"


# ── catalog ──────────────────────────────────────────────────────────────────

def test_fertilizer_is_shrub_q1_q4_and_turf_q1_q4(plan):
    fert = _services(plan, "fertilizer")
    slots = sorted(P.fertilizer_slot(s["name"]) for s in fert)
    assert slots == [("shrub", q) for q in (1, 2, 3, 4)] + [("turf", q) for q in (1, 2, 3, 4)]
    q3 = next(s for s in fert if P.fertilizer_slot(s["name"]) == ("shrub", 3))
    assert q3["aspire_service_id"] is None and q3["id"] == "maint-svc-fert-shrub-q3"
    assert "not in the Aspire catalog" in q3["flag"]
    assert all(s["default_occurrences"] == 1 and s["occurrence_source"] is None for s in fert)


def test_pest_control_is_two_services_on_the_ipm_count(plan):
    pest = _services(plan, "pest_control")
    assert sorted(s["name"] for s in pest) == ["Fungus and Turf Weed Control", "Insect and Disease Control"]
    assert {s["occurrence_source"] for s in pest} == {"ipm_occurrences"}
    assert {s["default_occurrences"] for s in pest} == {6}


def test_peak_and_off_peak_mowing_stay_separate_services(plan):
    turf = {s["name"]: s for s in _services(plan, "turf")}
    assert {"MC: PEAK Mowing", "MC: OFF-PEAK Mowing", "MC: Mowing Service"} <= set(turf)
    assert turf["MC: PEAK Mowing"]["id"] != turf["MC: OFF-PEAK Mowing"]["id"]
    assert turf["MC: PEAK Mowing"]["occurrence_source"] is None
    assert turf["MC: Mowing Service"]["occurrence_source"] == "mowing_occurrences"
    assert turf["MC: Mowing Service"]["default_occurrences"] == 40


def test_debris_roundup_warranty_are_optional(plan):
    optional = {s["name"] for s in _services(plan, "optional")}
    assert {"Debris Removal", "Round-up", "Warranty", "Mulch"} <= optional


def test_do_not_use_and_inactive_services_are_not_seeded(plan):
    names = {s["name"] for s in plan.services}
    assert "Mulch DO NOT USE" not in names and "Old Mulch" not in names
    reasons = {u["name"]: u["reason"] for u in plan.unassigned_services}
    assert reasons == {"Mulch DO NOT USE": "DO NOT USE", "Old Mulch": "inactive in Aspire"}


def test_standard_categories_carry_their_services_and_occurrence_sources(plan):
    assert [s["name"] for s in _services(plan, "bed_maint")] == ["MC: Pruning"]
    assert _services(plan, "bed_maint")[0]["occurrence_source"] == "pruning_occurrences"
    assert _services(plan, "irrigation")[0]["occurrence_source"] == "irrigation_occurrences"
    for s in plan.services:
        assert s["occurrence_source"] is None or s["occurrence_source"] in P.OCCURRENCE_SOURCES
        assert s["id"].startswith("maint-svc-")


def test_categories_match_live_group_names(plan):
    cats = {c["code"]: c for c in plan.categories}
    assert len(cats) == 6
    assert all(c["name_matches_live"] for c in cats.values())
    assert cats["optional"]["is_optional"] is True
    assert plan.unmapped_groups == []


def test_no_zone_sections_are_proposed(plan):
    sql = P.render_sql(plan)
    assert "estimate_sections" not in sql and "section_services" not in sql


# ── kits and rates ───────────────────────────────────────────────────────────

def _rate(plan, kit_id):
    return next(r for r in plan.rates if r["service_kit_id"] == kit_id)


def test_kit_links_join_takeoff_items_to_existing_kits_only(plan, kits):
    links = {(l["service_id"], l["service_kit_id"]) for l in plan.links}
    assert ("maint-svc-101", "kit-maint-3422") in links
    assert ("maint-svc-201", "kit-maint-3434") in links
    assert all(k in kits for _, k in links)
    assert not any(k == "kit-maint-77777" for _, k in links)
    assert [u["takeoff_item_id"] for u in plan.unlinked_takeoff_items] == [77777]
    # The quarter Aspire lacks prices through its sibling quarters' kits.
    assert ("maint-svc-fert-shrub-q3", "kit-maint-3439") in links


def test_null_rate_with_one_sampled_value_is_backfilled(plan):
    r = _rate(plan, "kit-maint-3434")
    assert r["proposed_rate"] == 1500 and r["action"] == "backfill NULL rate"
    assert "655100" in r["source_opportunities"]


def test_disagreeing_samples_stay_null(plan):
    r = _rate(plan, "kit-maint-3433")
    assert r["proposed_rate"] is None and "disagree" in r["action"]
    assert r["derived_rates"] == "900, 901, 902"


def test_turf_area_rates_are_never_changed(plan, kits):
    turf = [k for k, v in kits.items() if v["service_type"] == "Turf Area"]
    assert len(turf) >= 8
    for kit_id in turf:
        r = _rate(plan, kit_id)
        assert r["proposed_rate"] is None, kit_id
        assert r["action"].startswith("unchanged"), kit_id
    assert "disagrees with baseline" in _rate(plan, "kit-maint-3422")["action"]
    sql = P.render_sql(plan)
    for kit_id in turf:
        assert f"WHERE id = '{kit_id}'" not in sql


def test_non_inverted_factors_are_not_rates_and_unexercised_kits_stay_null(plan):
    r = _rate(plan, "kit-maint-3440")
    assert r["proposed_rate"] is None and r["non_inverted_factors"] == "30000"
    assert _rate(plan, "kit-maint-5541")["action"].startswith("stays NULL: no sampled")


def test_labour_rows_reconcile_and_are_never_rates(plan):
    assert [l["item_name"] for l in plan.labour] == ["Maintenance Labor"]
    assert plan.labour[0]["item_cost"] == 17.5
    assert "never written" in plan.labour[0]["note"]


# ── SQL ──────────────────────────────────────────────────────────────────────

def test_sql_only_fills_null_rates_and_never_touches_other_tables(plan):
    sql = P.render_sql(plan)
    updates = [l for l in sql.splitlines() if l.startswith("UPDATE")]
    assert updates == [
        "UPDATE service_kits SET production_rate = 1500.0 WHERE id = 'kit-maint-3434' "
        "AND kit_type = 'maintenance_hours' AND production_rate IS NULL;",
        "UPDATE service_kits SET production_rate = 20000.0 WHERE id = 'kit-maint-3439' "
        "AND kit_type = 'maintenance_hours' AND production_rate IS NULL;"]
    statements = "\n".join(l for l in sql.splitlines() if not l.startswith("--"))
    for forbidden in ("DELETE", "service_type", "materials", "DROP", "TRUNCATE", "ALTER"):
        assert forbidden not in statements
    assert sql.startswith("-- Maintenance service catalog seed")
    assert "START TRANSACTION;" in sql and sql.rstrip().endswith("COMMIT;")


def test_sql_upserts_services_with_an_aspire_id_guard(plan):
    sql = P.render_sql(plan)
    assert ("WHERE NOT EXISTS (SELECT 1 FROM services x WHERE x.aspire_service_id = 101 "
            "AND x.id <> 'maint-svc-101')") in sql
    assert sql.count("INSERT INTO services ") == len(plan.services)
    assert sql.count("INSERT INTO service_kit_links ") == len(plan.links)
    assert "'maint-cat-fertilizer'" in sql


def test_sql_escapes_quotes():
    assert P.sql_str("70' Lot") == "'70'' Lot'"
    assert P.sql_str(None) == "NULL"


# ── review folder ────────────────────────────────────────────────────────────

def test_write_review_emits_xlsx_csv_sql_report_and_raw(plan, tmp_path):
    raw = _pull(FakeAspire(build_data(1)))
    written = P.write_review(plan, raw, tmp_path / "review")
    names = {p.name for p in written}
    assert {"catalog_review.xlsx", "services.csv", "kit_links.csv", "rates.csv",
            "seed_maintenance_catalog.sql", "report.md", "kit_items.json"} <= names
    with zipfile.ZipFile(tmp_path / "review" / "catalog_review.xlsx") as z:
        assert [n for n, _ in sheet_targets(z)][:4] == ["Categories", "Services", "Kit Links", "Rates"]
    report = (tmp_path / "review" / "report.md").read_text()
    assert "### Fertilizer" in report and "Fertilizer Shrub - Quarter 3" in report


def test_refuses_to_write_into_a_tracked_repo_path():
    with pytest.raises(SystemExit):
        P.ensure_ignored(REPO / "scripts" / "data" / "not_ignored_review")
    P.ensure_ignored(REPO / "scripts" / "data" / "aspire_review" / "maintenance_catalog_x")


def test_script_never_touches_the_database():
    src = (REPO / "scripts" / "pull_aspire_service_catalog.py").read_text()
    for forbidden in ("pymysql", "import db", "from db", "aiomysql", "execute("):
        assert forbidden not in src
