"""GET /api/estimating/materials (Handoff 55 §2).

Unit checks cover query splitting, cursors and the response shape with a
mocked query. The DB checks (opt-in like tests/test_migrate.py: MYSQL_TEST_DB,
default crm_migrate_test, skipped when nothing answers) apply 070-073 to a
throwaway schema and run the endpoint's real SQL: filters, ranking,
item-class narrowing, null prices and a full keyset walk.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

os.environ.setdefault("JWT_SECRET", "test-secret")
import scripts.migrate as M  # noqa: E402
from api import materials_search as S  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from api.server import app, require_auth  # noqa: E402

client = TestClient(app)


# ── query building ────────────────────────────────────────────────────────────

def test_long_tokens_use_fulltext_prefix_terms():
    assert S.build_search("pvc pipe") == ("+pvc* +pipe*", [])


def test_short_fragments_and_stopwords_fall_back_to_like():
    against, like = S.build_search("pvc 1/2 in sch-40")
    assert against == "+pvc*"
    assert like == ["1/2", "in", "sch-40"]


def test_boolean_operators_in_input_are_not_passed_through():
    against, like = S.build_search('+weld -on "700" (clr)* ~ga <x>')
    assert against == "+weld* +700* +clr*"
    assert like == ["-on", "~ga", "<x>"]


def test_empty_and_punctuation_only_queries_have_no_terms():
    assert S.build_search("") == ("", [])
    assert S.build_search("  -- !! ") == ("", [])


def test_like_wildcards_are_escaped():
    sql, params, mode, _ = S.build_query("5%_x", [], 25, None)
    assert mode == "alpha"
    assert "%5\\%\\_x%" in params


def test_item_class_codes_parse_and_reject_garbage():
    assert S.parse_item_class_codes(None) == []
    assert S.parse_item_class_codes(" 601, 606,601 ,") == [601, 606]
    with pytest.raises(Exception):
        S.parse_item_class_codes("60x")


def test_query_always_limits_and_filters_bid_active():
    sql, params, _, _ = S.build_query("pvc", [601], 25, None)
    assert "m.available_to_bid = 1" in sql and "m.active = 1" in sql
    assert sql.rstrip().endswith("LIMIT %s") and params[-1] == 26
    assert "OFFSET" not in sql.upper()
    assert "material_prices mp" in sql and "mp.is_current = 1" in sql


def test_cursor_is_bound_to_mode_and_search():
    fp = S._fingerprint("pvc", [601])
    cur = S.encode_cursor({"m": "ft", "f": fp, "id": "1", "s": 5})
    assert S.decode_cursor(cur, "ft", fp)["s"] == 5
    for mode, other in (("alpha", fp), ("ft", S._fingerprint("oak", [601]))):
        with pytest.raises(Exception):
            S.decode_cursor(cur, mode, other)
    with pytest.raises(Exception):
        S.decode_cursor("not-base64!!", "ft", fp)


# ── endpoint (mocked query) ───────────────────────────────────────────────────

@pytest.fixture
def as_role():
    def _set(role):
        app.dependency_overrides[require_auth] = lambda: {
            "id": "u1", "name": "A", "email": "a@x.com", "role": role, "branch_id": None,
        }
    yield _set
    app.dependency_overrides.clear()


def _row(i, cost=100, score=10):
    return {"inventory_id": f"60{i:08d}", "description": f"PVC Pipe {i}", "alternate_name": None,
            "item_class": "IRRIGATION-PVC_PIPE__", "base_uom": "FT", "sales_uom": None,
            "purchase_uom": "FT", "preferred_vendor_name": "Vendor", "item_class_code": 606,
            "item_class_name": "IRR-PVC Pipe", "unit_cost_cents": cost, "cost_uom": "FT" if cost else None,
            "score": score}


def test_response_shape_and_null_price(as_role):
    as_role("install_estimating")
    with patch("api.materials_search.query", new_callable=AsyncMock) as q:
        q.return_value = [_row(1, cost=None)]
        res = client.get("/api/estimating/materials", params={"q": "pvc"})
    assert res.status_code == 200
    assert res.json() == {"items": [{
        "inventoryId": "6000000001", "description": "PVC Pipe 1", "alternateName": None,
        "itemClass": "IRRIGATION-PVC_PIPE__", "itemClassCode": 606, "itemClassName": "IRR-PVC Pipe",
        "itemClassLabel": "606-IRR-PVC Pipe", "uom": "FT", "baseUom": "FT", "salesUom": None,
        "purchaseUom": "FT", "preferredVendorName": "Vendor", "unitCostCents": None, "costUom": None,
    }], "nextCursor": None}


@pytest.mark.parametrize("asked,sent", [(1000, 101), (0, 2), (-5, 2), (None, 26)])
def test_limit_is_capped(as_role, asked, sent):
    as_role("install_estimating")
    with patch("api.materials_search.query", new_callable=AsyncMock) as q:
        q.return_value = [_row(i) for i in range(sent)]
        params = {"q": "pvc"} if asked is None else {"q": "pvc", "limit": asked}
        body = client.get("/api/estimating/materials", params=params).json()
    assert q.call_args.args[1][-1] == sent
    assert len(body["items"]) == sent - 1 and body["nextCursor"]


def test_requires_estimator(as_role):
    as_role("sales")
    assert client.get("/api/estimating/materials", params={"q": "pvc"}).status_code == 403


def test_bad_cursor_and_codes_are_400(as_role):
    as_role("install_estimating")
    with patch("api.materials_search.query", new_callable=AsyncMock):
        assert client.get("/api/estimating/materials", params={"cursor": "xx"}).status_code == 400
        assert client.get("/api/estimating/materials", params={"itemClassCodes": "a"}).status_code == 400


# ── MySQL: the real SQL over 070-073 ──────────────────────────────────────────

_TEST_DB = os.environ.get("MYSQL_TEST_DB", "crm_migrate_test")


def _db():
    import pymysql
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=_TEST_DB, autocommit=True, connect_timeout=2,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _reachable() -> bool:
    try:
        _db().close()
        return True
    except Exception:
        return False


requires_mysql = pytest.mark.skipif(not _reachable(), reason=f"MySQL test DB '{_TEST_DB}' not reachable")

_T = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
_BASE = f"""
CREATE TABLE estimates (id VARCHAR(36) NOT NULL PRIMARY KEY) {_T};
CREATE TABLE service_kits (id VARCHAR(36) NOT NULL PRIMARY KEY) {_T};
CREATE TABLE estimate_sections (id VARCHAR(36) NOT NULL PRIMARY KEY, estimate_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL) {_T};
CREATE TABLE section_services (id VARCHAR(36) NOT NULL PRIMARY KEY, section_id VARCHAR(36) NOT NULL,
    service_kit_id VARCHAR(36) DEFAULT NULL, label VARCHAR(255) NOT NULL) {_T};
"""

# inventory_id, description, alternate_name, item_class, item_status, available_to_bid, price
_ITEMS = [
    ("6060000001", "PVC Pipe 1in Sch40", None, "IRR-PIPE", "Active", 1, 345),
    ("6060000002", "PVC Pipe 2in Sch40", None, "IRR-PIPE", "Active", 1, None),
    ("6060000003", "PVC Pipe 3in Sch40 OLD", None, "IRR-PIPE", "Inactive", 1, 500),
    ("6060000004", "PVC Pipe 4in Sch40 NOBID", None, "IRR-PIPE", "Active", 0, 600),
    ("6010000005", "Weld-On 700 cement", "PVCS4010G2DD", "IRR-PARTS", "Active", 1, 708),
    ("8010000006", "Live Oak 3in CAL 65 GAL", None, "LG-TREES", "Active", 1, 25000),
    ("8010000007", "Cathedral Live Oak 45 GAL", None, "LG-TREES", "No Purchases", 1, 20000),
] + [(f"6050001{i:03d}", f"PVC Tee {i}in", None, "IRR-FIT", "Active", 1, 100 + i) for i in range(30)]


@pytest.fixture
def mat_db():
    conn = _db()
    _drop(conn)
    M.exec_statements(conn, M.split_statements(_BASE))
    for name in ("070_materials_catalog", "071_item_classes", "072_materials_item_status",
                 "073_service_catalog"):
        M.exec_file(conn, REPO / "sql" / "migrations" / f"{name}.sql")
    with conn.cursor() as cur:
        cur.execute("INSERT INTO item_class_groups (code, name) VALUES (600, 'IRR'), (800, 'LG')")
        cur.executemany(
            "INSERT INTO item_classes (item_class_id, code, name, group_code) VALUES (%s, %s, %s, %s)",
            [("IRR-PARTS", 601, "IRR-Irrigation Parts", 600), ("IRR-FIT", 605, "IRR-PVC Fittings", 600),
             ("IRR-PIPE", 606, "IRR-PVC Pipe", 600), ("LG-TREES", 801, "LG-Trees", 800)])
        for inv, desc, alt, cls, status, bid, price in _ITEMS:
            cur.execute(
                "INSERT INTO materials (inventory_id, description, alternate_name, item_class, "
                "item_status, available_to_bid, is_stock_item, base_uom) VALUES (%s,%s,%s,%s,%s,%s,1,'EA')",
                [inv, desc, alt, cls, status, bid])
            if price is not None:
                cur.execute(
                    "INSERT INTO material_prices (id, inventory_id, unit_cost_cents, uom, effective_from, "
                    "is_current, source) VALUES (%s, %s, %s, 'EA', '2026-09-01', 1, 'test')",
                    [f"mp-{inv}", inv, price])
    yield conn
    _drop(conn)
    conn.close()


def _drop(conn):
    with conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        cur.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")
        for row in cur.fetchall():
            cur.execute(f"DROP TABLE `{row['TABLE_NAME']}`")
        cur.execute("SET FOREIGN_KEY_CHECKS=1")


def _search(conn, q="", codes=(), limit=25, cursor=None):
    sql, params, mode, fp = S.build_query(q, list(codes), limit, cursor)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return rows, mode, fp


@requires_mysql
def test_inactive_and_not_bid_items_never_appear(mat_db):
    for q in ("", "pvc", "pvc pipe", "oak", "sch40 old", "nobid"):
        ids = {r["inventory_id"] for r in _search(mat_db, q, limit=100)[0]}
        assert not ids & {"6060000003", "6060000004", "8010000007"}, q


@requires_mysql
def test_two_word_query_ranks_description_matches_and_joins_price(mat_db):
    rows, mode, _ = _search(mat_db, "pvc pipe")
    assert mode == "ft"
    assert [r["inventory_id"] for r in rows] == ["6060000001", "6060000002"]
    by_id = {r["inventory_id"]: S.material_out(r) for r in rows}
    assert by_id["6060000001"]["unitCostCents"] == 345
    assert by_id["6060000002"]["unitCostCents"] is None  # no price row
    assert by_id["6060000001"]["itemClassLabel"] == "606-IRR-PVC Pipe"
    # A description hit outranks an alternate_name (vendor code) prefix hit.
    ranked = [r["inventory_id"] for r in _search(mat_db, "pvc", limit=100)[0]]
    assert ranked[-1] == "6010000005"


@requires_mysql
def test_item_class_codes_narrow_and_omitting_searches_everything(mat_db):
    everything = {r["inventory_id"] for r in _search(mat_db, "pvc", limit=100)[0]}
    pipe = {r["inventory_id"] for r in _search(mat_db, "pvc", codes=[606], limit=100)[0]}
    assert pipe == {"6060000001", "6060000002"}
    assert pipe < everything and "6010000005" in everything
    assert {r["inventory_id"] for r in _search(mat_db, "", codes=[801])[0]} == {"8010000006"}


@requires_mysql
def test_fulltext_is_word_prefix_and_short_fragments_use_like(mat_db):
    # "2in" is a FULLTEXT prefix term: matches the word 2in, not 12in / 22in.
    rows, _, _ = _search(mat_db, "pvc 2in", limit=100)
    assert {r["inventory_id"] for r in rows} == {"6050001002", "6060000002"}
    # "2" is too short for the index, so it is a LIKE substring match.
    rows, mode, _ = _search(mat_db, "tee 2", limit=100)
    assert mode == "ft"
    assert {r["description"] for r in rows} == {"PVC Tee 2in", "PVC Tee 12in", "PVC Tee 20in",
                                                 "PVC Tee 21in", "PVC Tee 22in", "PVC Tee 23in",
                                                 "PVC Tee 24in", "PVC Tee 25in", "PVC Tee 26in",
                                                 "PVC Tee 27in", "PVC Tee 28in", "PVC Tee 29in"}
    rows, mode, _ = _search(mat_db, "1/2", limit=100)
    assert mode == "alpha" and not rows


@requires_mysql
@pytest.mark.parametrize("q,codes", [("pvc", ()), ("", ()), ("tee", (605,))])
def test_keyset_walk_visits_every_row_once(mat_db, q, codes):
    expected = {r["inventory_id"] for r in _search(mat_db, q, codes, limit=100)[0]}
    seen, cursor = [], None
    while True:
        rows, mode, fp = _search(mat_db, q, codes, limit=4, cursor=cursor)
        page = rows[:4]
        seen += [r["inventory_id"] for r in page]
        if len(rows) <= 4:
            break
        last = page[-1]
        payload = {"m": mode, "f": fp, "id": last["inventory_id"]}
        payload.update({"s": int(last["score"])} if mode == "ft" else {"d": last["description"]})
        cursor = S.encode_cursor(payload)
    assert len(seen) == len(set(seen)) and set(seen) == expected
