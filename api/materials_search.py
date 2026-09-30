"""Materials search (Handoff 55 §2).

GET /api/estimating/materials?q=&itemClassCodes=&limit=&cursor=

Searches materials.description and materials.alternate_name with 073's
FULLTEXT index (ft_materials_description_alt) in boolean mode. A fragment the
index cannot serve (a token shorter than innodb_ft_min_token_size, or an InnoDB
stopword) falls back to LIKE. Always limited (default 25, cap 100) and keyset
paginated; the current price comes from the same query (no N+1).

Read-only over materials, material_prices and item_classes. materials.active
is a STORED generated column (072): it is read here, never written.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query

from api import authz
from db import query

DEFAULT_LIMIT = 25
MAX_LIMIT = 100
MAX_ITEM_CLASS_CODES = 100
# innodb_ft_min_token_size defaults to 3 (Cloud SQL and stock MySQL 8).
FT_MIN_TOKEN = 3
# INNODB_FT_DEFAULT_STOPWORD. A stopword in a +term is never indexed, so it
# would match nothing; such fragments go through LIKE instead.
FT_STOPWORDS = frozenset(
    "a about an are as at be by com de en for from how i in is it la of on or "
    "that the this to was what when where who will with und www".split()
)
_TOKEN_RE = re.compile(r"[0-9A-Za-z]+")
# One integer score so the keyset comparison is exact (MATCH returns a float).
_SCORE_SCALE = 1_000_000
# Added once per search token found in description, so an item whose
# description names the thing outranks one matched only through a vendor code
# in alternate_name (e.g. `pvc` vs `PVCS4010G2DD`). Larger than any MATCH score.
_DESCRIPTION_BONUS = 1_000_000_000_000


def _like_escape(fragment: str) -> str:
    return fragment.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_search(q: str) -> tuple[str, list[str]]:
    """Split q into a boolean-mode AGAINST string and LIKE fragments.

    Whitespace separates fragments. A fragment whose alphanumeric tokens are
    all FULLTEXT-servable becomes `+tok*` terms (prefix match; boolean-mode
    operators in the input are never passed through). Anything else, e.g.
    `3/4`, `pvc-40`, `in`, is matched with LIKE on either column.
    """
    ft_terms: list[str] = []
    like_fragments: list[str] = []
    for fragment in q.split():
        tokens = _TOKEN_RE.findall(fragment)
        if not tokens:
            continue
        if all(len(t) >= FT_MIN_TOKEN and t.lower() not in FT_STOPWORDS for t in tokens):
            ft_terms.extend(f"+{t}*" for t in tokens)
        else:
            like_fragments.append(fragment)
    # De-duplicate, keep order.
    return " ".join(dict.fromkeys(ft_terms)), list(dict.fromkeys(like_fragments))


def parse_item_class_codes(raw: Optional[str]) -> list[int]:
    if raw is None or not raw.strip():
        return []
    codes: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isdigit():
            raise HTTPException(
                status_code=400, detail="itemClassCodes must be comma-separated integers"
            )
        codes.append(int(part))
    codes = list(dict.fromkeys(codes))
    if len(codes) > MAX_ITEM_CLASS_CODES:
        raise HTTPException(status_code=400, detail="too many itemClassCodes")
    return codes


def _fingerprint(q: str, codes: list[int]) -> str:
    raw = json.dumps([" ".join(q.split()).lower(), sorted(codes)])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def encode_cursor(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")


def decode_cursor(cursor: str, mode: str, fingerprint: str) -> dict:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="invalid cursor")
    if (
        not isinstance(payload, dict)
        or payload.get("m") != mode
        or payload.get("f") != fingerprint
        or not isinstance(payload.get("id"), str)
    ):
        raise HTTPException(status_code=400, detail="cursor does not match this search")
    if mode == "ft" and not isinstance(payload.get("s"), int):
        raise HTTPException(status_code=400, detail="invalid cursor")
    if mode == "alpha" and not isinstance(payload.get("d"), str):
        raise HTTPException(status_code=400, detail="invalid cursor")
    return payload


def _int_or_none(v: Any) -> Optional[int]:
    return None if v is None else int(v)


def material_out(r: dict) -> dict:
    code = _int_or_none(r.get("item_class_code"))
    name = r.get("item_class_name")
    return {
        "inventoryId": r["inventory_id"],
        "description": r["description"],
        "alternateName": r.get("alternate_name"),
        "itemClass": r.get("item_class"),
        "itemClassCode": code,
        "itemClassName": name,
        # Human label in the Acumatica form the estimators use, e.g. 801-LG-Trees.
        "itemClassLabel": f"{code}-{name}" if code is not None and name else None,
        # Unit the estimator quantities in: sales UOM, else base UOM.
        "uom": r.get("sales_uom") or r.get("base_uom"),
        "baseUom": r.get("base_uom"),
        "salesUom": r.get("sales_uom"),
        "purchaseUom": r.get("purchase_uom"),
        "preferredVendorName": r.get("preferred_vendor_name"),
        # Current material_prices row; both null when the item has no price.
        "unitCostCents": _int_or_none(r.get("unit_cost_cents")),
        "costUom": r.get("cost_uom"),
    }


def build_query(
    q: str, codes: list[int], limit: int, cursor: Optional[str]
) -> tuple[str, list[Any], str, str]:
    """Return (sql, params, mode, fingerprint). Fetches limit + 1 rows."""
    against, like_fragments = build_search(q)
    mode = "ft" if against else "alpha"
    fingerprint = _fingerprint(q, codes)

    where = ["m.available_to_bid = 1", "m.active = 1"]
    where_params: list[Any] = []
    score_sql = "0"
    score_params: list[Any] = []
    if against:
        tokens = [t[1:-1] for t in against.split()]
        score_sql = (
            "(CAST(ROUND(MATCH(m.description, m.alternate_name) AGAINST (%s IN BOOLEAN MODE)"
            f" * {_SCORE_SCALE}) AS SIGNED)"
            + "".join(f" + (m.description LIKE %s) * {_DESCRIPTION_BONUS}" for _ in tokens)
            + ")"
        )
        score_params = [against, *(f"%{_like_escape(t)}%" for t in tokens)]
        where.append("MATCH(m.description, m.alternate_name) AGAINST (%s IN BOOLEAN MODE)")
        where_params.append(against)
    for fragment in like_fragments:
        pattern = f"%{_like_escape(fragment)}%"
        where.append("(m.description LIKE %s OR m.alternate_name LIKE %s)")
        where_params.extend([pattern, pattern])
    if codes:
        where.append(f"ic.code IN ({', '.join(['%s'] * len(codes))})")
        where_params.extend(codes)
    if cursor:
        c = decode_cursor(cursor, mode, fingerprint)
        if mode == "ft":
            where.append(f"({score_sql} < %s OR ({score_sql} = %s AND m.inventory_id > %s))")
            where_params.extend([*score_params, c["s"], *score_params, c["s"], c["id"]])
        else:
            where.append("(m.description > %s OR (m.description = %s AND m.inventory_id > %s))")
            where_params.extend([c["d"], c["d"], c["id"]])
    order = (
        "score DESC, m.inventory_id" if mode == "ft" else "m.description, m.inventory_id"
    )
    sql = f"""SELECT m.inventory_id, m.description, m.alternate_name, m.item_class,
                     m.base_uom, m.sales_uom, m.purchase_uom, m.preferred_vendor_name,
                     ic.code AS item_class_code, ic.name AS item_class_name,
                     mp.unit_cost_cents, mp.uom AS cost_uom,
                     {score_sql} AS score
                FROM materials m
                LEFT JOIN item_classes ic ON ic.item_class_id = m.item_class
                LEFT JOIN material_prices mp
                  ON mp.inventory_id = m.inventory_id AND mp.is_current = 1
               WHERE {' AND '.join(where)}
               ORDER BY {order}
               LIMIT %s"""
    return sql, [*score_params, *where_params, limit + 1], mode, fingerprint


def register(app, require_auth) -> None:
    @app.get("/api/estimating/materials")
    async def search_materials(
        q: str = Query("", max_length=200),
        item_class_codes: Optional[str] = Query(None, alias="itemClassCodes"),
        limit: int = Query(DEFAULT_LIMIT),
        cursor: Optional[str] = Query(None, max_length=512),
        _user: dict = Depends(require_auth),
    ) -> dict:
        """Ranked (q given) or alphabetical (no searchable q) bid-able materials.

        Response: {items: [...], nextCursor: str | null}. Pass nextCursor back
        with the same q and itemClassCodes for the next page.
        """
        authz.require_estimator(_user)
        limit = max(1, min(int(limit), MAX_LIMIT))
        codes = parse_item_class_codes(item_class_codes)
        sql, params, mode, fingerprint = build_query(q, codes, limit, cursor or None)
        rows = await query(sql, params)
        page = rows[:limit]
        next_cursor = None
        if len(rows) > limit and page:
            last = page[-1]
            payload: dict = {"m": mode, "f": fingerprint, "id": last["inventory_id"]}
            if mode == "ft":
                payload["s"] = int(last["score"])
            else:
                payload["d"] = last["description"]
            next_cursor = encode_cursor(payload)
        return {"items": [material_out(r) for r in page], "nextCursor": next_cursor}
