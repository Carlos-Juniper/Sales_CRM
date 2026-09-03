#!/usr/bin/env python3
"""Beam/Attentive Step 0 discovery — READ ONLY, spends nothing.

Answers what the API documentation cannot, against a takeoff we have already
paid for:

1. which of the ~110 feature identifiers are actually enabled on our account
2. the exact ``feature.name`` strings to seed the hardcoded map against
3. whether ``feature.id`` is a stable UUID (if so, key the map on it, not the name)
4. what compression ``output_geojson`` uses
5. which measurement names and units come back, so the conversion table is sized right

There is no list endpoint, so the request id has to be copied out of the Beam
portal by hand.

Usage (from repo root):

    python scripts/beam_discovery.py <attentive_request_id> [more ids...]

Passing two or more ids is worth doing: it is the only way to see whether
``feature.id`` is stable across requests.

Raw responses are written verbatim to tests/fixtures/beam/ for use as test
fixtures. Nothing is redacted, so check the dumps before committing them.
"""
from __future__ import annotations

import asyncio
import base64
import gzip
import json
import os
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

env_file = ROOT / ".env"
if env_file.exists():
    for _line in env_file.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip())

from api.beam_client import BeamClient, BeamError  # noqa: E402

FIXTURE_DIR = ROOT / "tests" / "fixtures" / "beam"

STATUS_NAMES = {
    1: "Draft", 2: "In Progress", 3: "Completed", 4: "Failed",
    5: "Queued", 6: "Investigating", 7: "Resubmitted",
}


def sniff_compression(blob: str) -> str:
    """Identify how output_geojson is encoded. Open item M4, answered empirically."""
    if not isinstance(blob, str) or not blob:
        return "absent"
    try:
        raw = base64.b64decode(blob, validate=True)
    except Exception:
        raw = blob.encode("utf-8", "surrogateescape")
        prefix = "raw"
    else:
        prefix = "base64"
    for name, fn in (
        ("gzip", gzip.decompress),
        ("zlib", zlib.decompress),
        ("deflate", lambda b: zlib.decompress(b, -zlib.MAX_WBITS)),
    ):
        try:
            text = fn(raw).decode("utf-8")
        except Exception:
            continue
        return f"{prefix}+{name} -> {text[:60]}..."
    if raw[:1] == b"{":
        return f"{prefix}, uncompressed JSON"
    return f"{prefix}, unrecognised (first bytes {raw[:8]!r})"


async def inspect(client: BeamClient, request_id: str) -> dict:
    request = await client.get_request(request_id)
    outputs = await client.get_outputs(request_id)

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (FIXTURE_DIR / f"request_{request_id}.json").write_text(json.dumps(request, indent=2))
    (FIXTURE_DIR / f"outputs_{request_id}.json").write_text(json.dumps(outputs, indent=2))

    status = request.get("status")
    print(f"\n=== request {request_id} ===")
    print(f"  status        {status} ({STATUS_NAMES.get(status, '?')})")
    print(f"  cost          {request.get('cost')} cents")
    print(f"  eta           {request.get('eta')} s")
    print(f"  report_type   {request.get('report_type')}")
    print(f"  parcel_area   {(request.get('input') or {}).get('parcel_area')}")
    print(f"  downstream    {request.get('downstream_metadata')}")
    print(f"  completed_at  {request.get('completed_at')}")

    rows = outputs if isinstance(outputs, list) else outputs.get("results", outputs.get("data", []))
    print(f"\n  {len(rows)} outputs")
    features: dict[str, str] = {}
    for row in rows:
        feature = row.get("feature") or {}
        name = feature.get("name", "?")
        features[name] = feature.get("id", "")
        for m in row.get("measurements") or []:
            print(
                f"    {name:<28} {m.get('name','?'):<10} "
                f"{m.get('value','?'):>14} {m.get('unit','?'):<8} "
                f"geom={feature.get('geometry_type')} custom={row.get('is_custom')}"
            )
    if rows:
        print(f"\n  output_geojson encoding: {sniff_compression(rows[0].get('output_geojson'))}")
    print(f"\n  wrote fixtures to {FIXTURE_DIR}")
    return features


async def main() -> int:
    ids = sys.argv[1:]
    if not ids:
        print(__doc__)
        return 1

    seen: dict[str, dict[str, str]] = {}
    async with BeamClient() as client:
        for request_id in ids:
            try:
                seen[request_id] = await inspect(client, request_id)
            except BeamError as exc:
                print(f"\n=== request {request_id} === FAILED: {exc}")
                return 1

    all_names = sorted({n for f in seen.values() for n in f})
    print(f"\n=== {len(all_names)} distinct features enabled on this account ===")
    for name in all_names:
        print(f"  {name}")

    if len(seen) > 1:
        unstable = [
            name for name in all_names
            if len({f[name] for f in seen.values() if name in f}) > 1
        ]
        print(
            "\nfeature.id is STABLE across requests — key the map on the id"
            if not unstable
            else f"\nfeature.id VARIES for {unstable} — key the map on feature.name"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
