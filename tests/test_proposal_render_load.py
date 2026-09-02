"""Gated load / memory test for the server-side PDF renderer (Handoff 39).

This is a *live-stack* load test, skipped by default. It drives the REAL browser
render path in `api.proposal_render.render_proposal_pdf`:

  * real DB read of `proposal_requests`
  * real render-token mint
  * real Chromium: new_context -> page.goto(<PDF_BASE_URL>/proposals/<id>/print)
    -> wait_for_function(__PROPOSAL_READY__) -> page.pdf(...) -> context.close()

Only the three post-render *write* seams are monkeypatched, because they touch
GCS / the renders table and would crash locally (GCS_ATTACHMENTS_BUCKET is empty):

  * api.proposal_render.upload_bytes   -> no-op
  * api.proposal_render.signed_get_url -> returns a dummy string
  * the final `execute(INSERT ...)`     -> no-op (patched via db.execute)

The browser render itself (Chromium, page.pdf, same-origin /fonts/ fetches, and
the per-page frond data-URL decode) is NOT stubbed — that is the whole point of
measuring memory.

Requires a live stack:
  * uvicorn api.server:app on :8000 (PDF_RENDER_ENABLED=1) so the print page's
    /api/* fetches (proxied by vite) resolve
  * vite serving the print page at PDF_BASE_URL (default http://127.0.0.1:8080)

Run:
    RUN_RENDER_LOAD=1 PDF_BASE_URL=http://127.0.0.1:8080 \
        python -m pytest tests/test_proposal_render_load.py -q -s
"""
from __future__ import annotations

import asyncio
import os

import pytest

# Env must be set before importing the app / render module.
os.environ.setdefault("MYSQL_HOST", "127.0.0.1")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_RENDER_LOAD") != "1",
    reason="load test; needs live vite+uvicorn stack",
)

# The proposal must exist in the DB the backend is pointed at (demo seed row).
_PROPOSAL_ID = "prop-07a4894270e7"

# The user only needs the claim shape _mint_render_token reads.
_USER = {
    "id": "u1",
    "name": "Load Tester",
    "email": "load@x.com",
    "role": "sales",
    "branch_id": "Fort Myers, FL",
}

_CONCURRENT_N = 5
_SEQUENTIAL_N = 20
_RSS_TOLERANCE = 1.10  # end RSS must be <= start RSS * 1.10


def _total_rss_mb() -> float:
    """RSS of this process + all descendant Chromium processes, in MB."""
    import psutil

    proc = psutil.Process()
    total = proc.memory_info().rss
    for child in proc.children(recursive=True):
        try:
            total += child.memory_info().rss
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return total / (1024 * 1024)


@pytest.mark.asyncio
async def test_render_load_rss_stable_under_5_concurrent_20_sequential(monkeypatch):
    import api.proposal_render as render_mod
    import db as db_mod

    # ── Monkeypatch ONLY the post-render write seams (browser stays real) ──
    monkeypatch.setattr(
        render_mod, "upload_bytes", lambda *a, **k: None, raising=True
    )
    monkeypatch.setattr(
        render_mod,
        "signed_get_url",
        lambda *a, **k: "https://example.test/dummy-download-url",
        raising=True,
    )

    # The final INSERT into proposal_renders goes through db.execute; the render
    # module does `from db import execute` inside the function, so patch the
    # source attribute. Keep query() real (the DB reads must run).
    _real_execute = db_mod.execute

    async def _execute_guard(sql, params=None):
        if "INSERT INTO proposal_renders" in sql:
            return None  # no-op: don't write render rows during the load test
        return await _real_execute(sql, params)

    monkeypatch.setattr(db_mod, "execute", _execute_guard, raising=True)

    # ── Bring up a real Chromium in THIS process (the RSS we measure) ──
    await render_mod.start_browser()
    try:
        # Warm-up render so start RSS is measured with the browser warm
        # (fonts fetched, first context/page allocated, JIT warm).
        warm = await render_mod.render_proposal_pdf(_PROPOSAL_ID, _USER)
        assert warm.page_count and warm.page_count > 0

        start_rss = _total_rss_mb()

        # ── 5 concurrent renders ──
        concurrent_results = await asyncio.gather(
            *(render_mod.render_proposal_pdf(_PROPOSAL_ID, _USER)
              for _ in range(_CONCURRENT_N))
        )
        for i, r in enumerate(concurrent_results):
            assert r.object_key, f"concurrent render {i}: missing object_key"
            assert r.page_count and r.page_count > 0, (
                f"concurrent render {i}: page_count={r.page_count!r}"
            )

        # ── 20 sequential renders ──
        seq_page_counts = []
        for i in range(_SEQUENTIAL_N):
            r = await render_mod.render_proposal_pdf(_PROPOSAL_ID, _USER)
            assert r.page_count and r.page_count > 0, (
                f"sequential render {i}: page_count={r.page_count!r}"
            )
            seq_page_counts.append(r.page_count)

        end_rss = _total_rss_mb()
    finally:
        await render_mod.stop_browser()

    all_pages = [r.page_count for r in concurrent_results] + seq_page_counts
    pct_delta = (end_rss - start_rss) / start_rss * 100.0

    # Report regardless of pass/fail — these numbers go into the docs ledger.
    print("\n" + "=" * 60)
    print("PDF RENDER LOAD TEST — RSS (process + Chromium children)")
    print(f"  start RSS : {start_rss:.1f} MB (after warm-up render)")
    print(f"  end RSS   : {end_rss:.1f} MB")
    print(f"  delta     : {pct_delta:+.1f}%  "
          f"(bound: <= +{(_RSS_TOLERANCE - 1) * 100:.0f}%)")
    print(f"  renders   : {_CONCURRENT_N} concurrent + {_SEQUENTIAL_N} sequential "
          f"(+1 warm-up)")
    print(f"  page_count: min={min(all_pages)} max={max(all_pages)}")
    print(f"  RESULT    : {'PASS' if end_rss <= start_rss * _RSS_TOLERANCE else 'FAIL'}")
    print("=" * 60)

    assert end_rss <= start_rss * _RSS_TOLERANCE, (
        f"RSS grew beyond {( _RSS_TOLERANCE - 1) * 100:.0f}%: "
        f"start={start_rss:.1f}MB end={end_rss:.1f}MB ({pct_delta:+.1f}%)"
    )
