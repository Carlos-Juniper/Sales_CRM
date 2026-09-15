"""Headless-Chromium PDF rendering for proposals (Handoff 39).

Browser lifecycle is process-wide: one Chromium launched in the FastAPI lifespan,
one BrowserContext per render, closed in a finally block. Never launch per request.

Env vars:
  PDF_RENDER_ENABLED     — '1'/'true'/'yes' to enable (default off; tests must not spawn Chromium)
  PDF_MAX_CONCURRENCY    — semaphore cap (default 2)
  PDF_RENDER_TIMEOUT_MS  — per-render timeout in ms (default 60000)
  PDF_BASE_URL           — base URL for the React app (default http://127.0.0.1:8080)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

PDF_MAX_CONCURRENCY = int(os.environ.get("PDF_MAX_CONCURRENCY", "2"))
PDF_RENDER_TIMEOUT_MS = int(os.environ.get("PDF_RENDER_TIMEOUT_MS", "60000"))
PDF_BASE_URL = os.environ.get("PDF_BASE_URL", "http://127.0.0.1:8080")

_playwright_instance: Optional[object] = None
_browser: Optional[object] = None
_semaphore: asyncio.Semaphore = asyncio.Semaphore(PDF_MAX_CONCURRENCY)


async def start_browser() -> None:
    """Called from the FastAPI lifespan on startup when PDF_RENDER_ENABLED."""
    global _playwright_instance, _browser
    from playwright.async_api import async_playwright
    _playwright_instance = await async_playwright().start()
    _browser = await _playwright_instance.chromium.launch(
        args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--font-render-hinting=none",
        ],
    )
    logger.info("Headless Chromium started for proposal PDF rendering")


async def stop_browser() -> None:
    """Called from the FastAPI lifespan finally block."""
    global _playwright_instance, _browser
    if _browser is not None:
        await _browser.close()
        _browser = None
    if _playwright_instance is not None:
        await _playwright_instance.stop()
        _playwright_instance = None


@dataclass
class RenderResult:
    id: str
    status: str           # 'complete' | 'pending' | 'failed'
    object_key: Optional[str]
    download_url: Optional[str]
    page_count: Optional[int]
    version: int
    rendered_at: Optional[str]
    # Pages whose content did not fit their 11in sheet and was therefore clipped
    # out of the PDF. Reported, not fatal: the render is still a usable document
    # and deciding what to cut from an overfull page is an editorial call. The
    # point is that a rep finds out before the client does.
    # Each entry: {"page": int, "testId": str | None, "overflowPx": int}
    overflowing_pages: list = field(default_factory=list)
    # One entry per appended proposal document (Handoff 47 §5): {attachmentId,
    # kind, fileName, pageCount, firstPage}. Empty when nothing was attached.
    document_manifest: list = field(default_factory=list)


def _mint_render_token(
    proposal_id: str,
    user: dict,
    lead_id: Optional[str] = None,
    estimate_id: Optional[str] = None,
) -> str:
    """Mint a short-lived render-scoped JWT for internal Chromium use.

    lead_id and estimate_id are carried as claims because the print route fetches
    /api/leads/{lead_id} and /api/estimating/estimates/{estimate_id} in addition to
    the proposal itself, and the scope guard in server.py admits only the exact ids
    named here — the token still cannot read any other lead or estimate.
    """
    import jwt as pyjwt
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
        "exp": datetime.now(timezone.utc) + timedelta(seconds=120),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)



async def render_proposal_pdf(proposal_id: str, user: dict) -> RenderResult:
    """The single awaitable. Route awaits it today; a queue worker calls it tomorrow."""
    if _browser is None:
        raise RuntimeError("Browser not started — check lifespan wiring or PDF_RENDER_ENABLED")

    from db import execute, query
    from api.attachments import upload_bytes, signed_get_url
    from api.proposal_documents import append_proposal_documents
    from pypdf import PdfReader
    from io import BytesIO

    rows = await query(
        "SELECT COALESCE(MAX(version), 0) AS max_v FROM proposal_renders WHERE proposal_id = %s",
        (proposal_id,),
    )
    next_version = (rows[0]["max_v"] if rows else 0) + 1
    object_key = f"proposal/generated/{proposal_id}/v{next_version}.pdf"
    render_id = f"pr-{uuid.uuid4().hex[:12]}"

    # The print route blocks on lead and estimate as well as the proposal, so the
    # token has to name them or the page never reaches __PROPOSAL_READY__.
    prop_rows = await query(
        "SELECT lead_id, estimate_id FROM proposal_requests WHERE id = %s",
        (proposal_id,),
    )
    if not prop_rows:
        raise RuntimeError(f"Proposal {proposal_id} not found")

    token = _mint_render_token(
        proposal_id, user, prop_rows[0]["lead_id"], prop_rows[0]["estimate_id"],
    )
    start_ms = int(time.time() * 1000)

    async with _semaphore:
        context = await _browser.new_context(viewport={"width": 1200, "height": 1600})
        try:
            await context.add_cookies([{
                "name": "session",
                "value": token,
                "domain": "127.0.0.1",
                "path": "/",
            }])
            page = await context.new_page()
            page.set_default_timeout(PDF_RENDER_TIMEOUT_MS)

            await page.goto(
                f"{PDF_BASE_URL}/proposals/{proposal_id}/print",
                wait_until="networkidle",
            )
            await page.wait_for_function(
                "window.__PROPOSAL_READY__ === true",
                timeout=PDF_RENDER_TIMEOUT_MS,
            )

            # ProposalPrintRoute publishes this BEFORE it flips __PROPOSAL_READY__
            # (see the ordering comment there), so by the time we get here it is
            # already populated. Read it before page.pdf() anyway — nothing about
            # the capture should be able to disturb it.
            overflowing_pages = await page.evaluate(
                "window.__PROPOSAL_OVERFLOW__ || []"
            )

            # prefer_css_page_size wins, so `@page { size: letter }` in
            # studio/src/styles/proposal-print.css is what actually sizes the
            # sheet; format is only the fallback and must agree with it.
            #
            # display_header_footer is off and the templates are gone. That CSS
            # also sets `@page { margin: 0 }` so the footer bar can bleed to the
            # paper edge, and Chromium draws header/footer templates *into the
            # page margin box* — zero margin, zero box, templates clipped to
            # nothing. Page numbers are rendered in the document body by
            # ProposalPreview.tsx instead.
            pdf_bytes = await page.pdf(
                format="Letter",
                print_background=True,
                prefer_css_page_size=True,
                display_header_footer=False,
            )
        finally:
            await context.close()

    # Append proposal documents (measurements → contract → other) to the tail,
    # after the thank-you page (Handoff 47 §5). With nothing attached this
    # returns pdf_bytes unchanged, so the output is byte-identical to a render
    # without documents. The data/infra guards it raises propagate to the render
    # route, which maps them to 422 / 503 (§7).
    #
    # WS2: estimate_id may be NULL for estimate-optional proposals. When it is
    # NULL we fall back to lead_id so lead-scoped proposal documents are appended
    # correctly. Once POST /api/proposals re-anchors uploads to the estimate (the
    # re-anchor step), estimate_id will be set and this branch is unreachable.
    estimate_id = prop_rows[0]["estimate_id"]
    _lead_id = prop_rows[0]["lead_id"]
    if estimate_id:
        final_bytes, document_manifest = await append_proposal_documents(
            pdf_bytes, estimate_id=estimate_id
        )
    else:
        final_bytes, document_manifest = await append_proposal_documents(
            pdf_bytes, lead_id=_lead_id
        )

    duration_ms = int(time.time() * 1000) - start_ms
    # The real page count of the FINAL merged bytes. The old
    # `pdf_bytes.count(b"/Type /Page")` also matched the /Type /Pages tree node
    # and depended on Chromium's dictionary spacing, and was meaningless after a
    # merge (§5.4).
    page_count = len(PdfReader(BytesIO(final_bytes)).pages)

    upload_bytes(object_key, final_bytes, "application/pdf")
    download_url = signed_get_url(object_key, f"proposal-v{next_version}.pdf")

    rendered_at = datetime.now(timezone.utc).isoformat()

    # overflowing_pages is stored as JSON, and '[]' is written deliberately when
    # nothing was clipped: the column is NULL only for renders that predate
    # overflow detection, so "was this render measured?" stays answerable.
    await execute(
        """
        INSERT INTO proposal_renders
            (id, proposal_id, version, object_key, page_count, status,
             rendered_by, duration_ms, overflowing_pages, created_at)
        VALUES (%s, %s, %s, %s, %s, 'complete', %s, %s, %s, NOW())
        """,
        (render_id, proposal_id, next_version, object_key, page_count,
         user["id"], duration_ms, json.dumps(overflowing_pages)),
    )

    logger.info(
        "Proposal %s rendered: v%d, %d pages, %d ms",
        proposal_id, next_version, page_count or 0, duration_ms,
    )

    if overflowing_pages:
        # WARNING, not an exception: the PDF is still a usable document and the
        # rep may well intend a tight page. But a silently truncated proposal
        # reaching a customer is the failure this exists to prevent, so it must
        # appear in the logs even when nobody is watching the UI.
        logger.warning(
            "Proposal %s v%d: content clipped on %d page(s): %s",
            proposal_id, next_version, len(overflowing_pages), overflowing_pages,
        )

    return RenderResult(
        id=render_id,
        status="complete",
        object_key=object_key,
        download_url=download_url,
        page_count=page_count,
        version=next_version,
        rendered_at=rendered_at,
        overflowing_pages=overflowing_pages,
        document_manifest=document_manifest,
    )
