#!/usr/bin/env python3
"""Screenshot real proposal pages via the actual print route (Handoff 52 follow-up).

Renders the SAME /proposals/{id}/print route that api/proposal_render.py feeds
into page.pdf() for the real PDF — real React tree, real bundled CSS, real
photo assets, real overflow instrumentation. This exists because a hand-copied
HTML harness (rebuilt from scratch each session) silently drifted from what
the app actually renders and reported a fix as working when it wasn't.

Mints the same short-lived render-scoped JWT proposal_render.py uses (see
api/proposal_render.py's _mint_render_token) and sets it as the "session"
cookie, so no interactive Entra login is needed.

Usage (from repo root, needs the project venv — aiomysql/jwt/playwright):
    python scripts/proposal_page_screenshot.py <proposal_id> [page_testid ...]
    python scripts/proposal_page_screenshot.py prop-8540dfd7d423 \
        page-service-services_design page-service-services_enhancements

With no page_testid args, screenshots every .print-page and lists them.
Reads window.__PROPOSAL_OVERFLOW__ (the app's own clipping detector) and
prints it — that number is ground truth for "does this page overflow", no
pixel-peeping required.

Env:
  STUDIO_BASE_URL  — default http://localhost:5175 (match your vite dev server)
  OUT_DIR          — default ./scratch_proposal_screenshots next to this script
"""
from __future__ import annotations

import asyncio
import os
import sys
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

from db import query  # noqa: E402


async def _find_render_user() -> dict:
    """Any admin user works — the render token only needs to pass authz."""
    rows = await query(
        "SELECT id, name, email, role, branch_id FROM users WHERE role = 'admin' LIMIT 1"
    )
    if not rows:
        rows = await query("SELECT id, name, email, role, branch_id FROM users LIMIT 1")
    if not rows:
        raise RuntimeError("No users found in DB to mint a render token for")
    return rows[0]


async def _proposal_ids(proposal_id: str) -> tuple[str | None, str | None]:
    rows = await query(
        "SELECT lead_id, estimate_id FROM proposal_requests WHERE id = %s", (proposal_id,)
    )
    if not rows:
        raise RuntimeError(f"Proposal {proposal_id} not found in proposal_requests")
    return rows[0]["lead_id"], rows[0]["estimate_id"]


def _mint_token(proposal_id: str, user: dict, lead_id, estimate_id) -> str:
    import jwt as pyjwt
    from datetime import datetime, timedelta, timezone
    from api.server import JWT_SECRET, JWT_ALGORITHM

    payload = {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "branch_id": user["branch_id"],
        "scope": "proposal_render",
        "proposal_id": proposal_id,
        "lead_id": lead_id,
        "estimate_id": estimate_id,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=300),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    proposal_id = sys.argv[1]
    wanted_testids = sys.argv[2:]

    base_url = os.environ.get("STUDIO_BASE_URL", "http://localhost:5175")
    out_dir = Path(os.environ.get("OUT_DIR", Path(__file__).parent / "scratch_proposal_screenshots"))
    out_dir.mkdir(parents=True, exist_ok=True)

    user = await _find_render_user()
    lead_id, estimate_id = await _proposal_ids(proposal_id)
    token = _mint_token(proposal_id, user, lead_id, estimate_id)

    from urllib.parse import urlparse
    from playwright.async_api import async_playwright

    host = urlparse(base_url).hostname or "localhost"

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={"width": 1200, "height": 1600})
        await context.add_cookies([{"name": "session", "value": token, "domain": host, "path": "/"}])
        page = await context.new_page()
        page.set_default_timeout(60000)

        await page.goto(f"{base_url}/proposals/{proposal_id}/print", wait_until="networkidle")
        await page.wait_for_function("window.__PROPOSAL_READY__ === true")

        overflow = await page.evaluate("window.__PROPOSAL_OVERFLOW__ || []")
        if overflow:
            print("OVERFLOWING PAGES (from the app's own instrumentation):")
            for o in overflow:
                print(f"  page {o['page']:>2}  {o['testId']:<40}  {o['overflowPx']}px clipped")
        else:
            print("No overflowing pages reported by window.__PROPOSAL_OVERFLOW__.")

        nodes = await page.query_selector_all(".print-page")
        print(f"\nfound {len(nodes)} .print-page nodes")
        for i, node in enumerate(nodes):
            testid = await node.get_attribute("data-testid")
            print(f"  {i:>2}  {testid}")
            if wanted_testids and testid not in wanted_testids:
                continue
            out_path = out_dir / f"page-{i:02d}-{testid}.png"
            await node.screenshot(path=str(out_path))
            print(f"      -> wrote {out_path}")

        await browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
