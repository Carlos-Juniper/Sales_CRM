"""Append the estimate's proposal documents to a rendered proposal PDF.

Handoff 47 §5. Aspire has no API for the contract or the measurement totals, so
a rep uploads Aspire's *Print Proposal* export against the estimate. Those
documents are appended to the tail of the server-rendered proposal PDF, after
the thank-you page, in a fixed order: measurements → contract → other.

This module owns the append. It is deliberately separate from
api/proposal_render.py, which owns the headless-browser lifecycle and should not
grow a second responsibility (§5.1).

Libraries: pypdf (merge + page count) and Pillow (image → Letter page). Both are
pure wheels — no system packages — which is why this approach was chosen over
rasterising the uploaded PDF with poppler (§5.2). Both are pinned in
requirements.txt.

Failure model (§7):
  - A pending/failed row at render time → ProposalDocumentDataError (the caller
    maps it to 422, naming the file — a half-finished upload must never silently
    drop the contract).
  - A GCS read failure → ProposalDocumentInfraError (the caller maps it to 503 +
    Retry-After).
  - Confirm-time validation of a single file (encrypted/corrupt PDF or undecodable
    image) → DocumentValidationError, raised from validate_document_bytes().
"""
from __future__ import annotations

import io
import logging

from pypdf import PdfReader, PdfWriter

from db import query

logger = logging.getLogger(__name__)

# The three estimate-scoped proposal document kinds, in append order.
PROPOSAL_KINDS = ("proposal_measurements", "proposal_contract", "proposal_other")

# A very large appended document is unusual but legitimate — this is the last
# step before a client-facing send and a rep may deliberately assemble one. We
# warn loudly (never block) past these thresholds (§7).
_WARN_PAGE_COUNT = 200
_WARN_OUTPUT_BYTES = 50 * 1024 * 1024  # 50 MiB

# Letter portrait at 150 DPI. 612 x 792 pt is the PDF media box regardless of DPI.
_DPI = 150
_LETTER_PX = (int(8.5 * _DPI), int(11 * _DPI))  # 1275 x 1650
# Printable area — a small margin so a full-bleed screenshot is not clipped at
# the sheet edge. Matches the reference's full-page raster intent (§2, §5.3).
_MARGIN_PX = int(0.25 * _DPI)


class DocumentValidationError(Exception):
    """A single uploaded document is unusable (encrypted/corrupt PDF, undecodable
    image). Raised at CONFIRM time so the rep learns while still in the form."""


class ProposalDocumentDataError(Exception):
    """A data problem detected at render time (e.g. a pending/failed row). The
    render route maps this to HTTP 422."""


class ProposalDocumentInfraError(Exception):
    """An infrastructure problem at render time (e.g. GCS read failure). The
    render route maps this to HTTP 503 + Retry-After."""


# ── Image → Letter page ───────────────────────────────────────────────────────

def image_to_letter_pdf(image_bytes: bytes) -> bytes:
    """Wrap a raster image in a single centred Letter-portrait PDF page.

    A blank white 150-DPI Letter canvas, the image scaled to fit the printable
    area preserving aspect (Image.thumbnail), centred, saved as a one-page PDF at
    612 x 792 pt.

    Deliberately NOT Image.save(..., 'PDF') on the raw image — that emits a page
    sized to the image's pixels at 72 DPI, so a 4000px screenshot becomes a
    55-inch page that merges without error and prints as garbage (§5.3).
    """
    from PIL import Image, UnidentifiedImageError

    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise DocumentValidationError(f"Image could not be decoded: {exc}") from exc

    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    canvas = Image.new("RGB", _LETTER_PX, (255, 255, 255))
    printable = (_LETTER_PX[0] - 2 * _MARGIN_PX, _LETTER_PX[1] - 2 * _MARGIN_PX)
    fitted = img.copy()
    fitted.thumbnail(printable, Image.LANCZOS)
    offset = (
        (_LETTER_PX[0] - fitted.width) // 2,
        (_LETTER_PX[1] - fitted.height) // 2,
    )
    canvas.paste(fitted, offset)

    buf = io.BytesIO()
    canvas.save(buf, "PDF", resolution=float(_DPI))
    return buf.getvalue()


# ── Confirm-time validation ───────────────────────────────────────────────────

def validate_document_bytes(content_type: str, data: bytes) -> int:
    """Validate a single uploaded document and return its page count.

    Called from the confirm endpoint (§7): opening the file there means the rep
    learns the file is unusable while still in the form, not at render time.

    Returns the page count (1 for images). Raises DocumentValidationError for an
    encrypted or corrupt PDF, or an undecodable image.
    """
    if content_type == "application/pdf":
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise DocumentValidationError(
                    "PDF is encrypted/password-protected — export an unprotected copy"
                )
            return len(reader.pages)
        except DocumentValidationError:
            raise
        except Exception as exc:  # pypdf raises assorted errors on malformed input
            raise DocumentValidationError(f"PDF could not be read: {exc}") from exc

    # Image kinds: proving it wraps to a Letter page proves it decodes.
    image_to_letter_pdf(data)
    return 1


# ── The append itself ─────────────────────────────────────────────────────────

async def append_proposal_documents(
    pdf_bytes: bytes,
    estimate_id: str | None = None,
    lead_id: str | None = None,
) -> tuple[bytes, list[dict]]:
    """Append the proposal documents to a rendered proposal PDF.

    Returns the merged bytes and a manifest — one entry per appended document
    ({attachmentId, kind, fileName, pageCount, firstPage}) — for the render row
    and the response, so a rep can see what landed without opening the PDF.

    Order: measurements → contract → other (FIELD() pins the group order
    independently of sort_order, which orders within a group). id is the final
    tiebreak so the output is byte-stable across renders (§5.1).

    When estimate_id is provided (the normal case), queries by estimate_id.
    When estimate_id is None and lead_id is provided (estimate-optional proposal,
    WS2), queries by lead_id instead — these are rows uploaded before the
    estimate existed. Both paths use the same ordering and status filter.

    When the proposal has no documents, returns pdf_bytes unchanged and an empty
    manifest — a render with nothing attached is byte-identical to today's output.
    """
    if estimate_id:
        rows = await query(
            """
            SELECT id, kind, file_name, content_type, object_key, status,
                   sort_order, created_at
              FROM intake_attachments
             WHERE estimate_id = %s
               AND status <> 'deleted'
               AND kind IN ('proposal_measurements','proposal_contract','proposal_other')
             ORDER BY FIELD(kind,'proposal_measurements','proposal_contract','proposal_other'),
                      sort_order, created_at, id
            """,
            (estimate_id,),
        )
    elif lead_id:
        rows = await query(
            """
            SELECT id, kind, file_name, content_type, object_key, status,
                   sort_order, created_at
              FROM intake_attachments
             WHERE lead_id = %s
               AND estimate_id IS NULL
               AND status <> 'deleted'
               AND kind IN ('proposal_measurements','proposal_contract','proposal_other')
             ORDER BY FIELD(kind,'proposal_measurements','proposal_contract','proposal_other'),
                      sort_order, created_at, id
            """,
            (lead_id,),
        )
    else:
        rows = []

    if not rows:
        return pdf_bytes, []

    # A half-finished upload must never silently drop the contract (§7): a
    # pending/failed row is a data problem the rep has to resolve first.
    for row in rows:
        if row.get("status") != "stored":
            raise ProposalDocumentDataError(
                f"Document '{row.get('file_name') or row.get('id')}' is not ready "
                f"(status={row.get('status')}). Re-upload it before generating the proposal."
            )

    base = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    for page in base.pages:
        writer.add_page(page)

    manifest: list[dict] = []
    for row in rows:
        object_key = row.get("object_key")
        if not object_key:
            raise ProposalDocumentDataError(
                f"Document '{row.get('file_name') or row.get('id')}' has no stored object."
            )
        try:
            data = download_bytes(object_key)
        except Exception as exc:  # GCS 404 / read error
            raise ProposalDocumentInfraError(
                f"Could not read '{row.get('file_name')}' from storage: {exc}"
            ) from exc

        content_type = row.get("content_type") or "application/pdf"
        first_page = len(writer.pages) + 1  # 1-indexed start of this document

        if content_type == "application/pdf":
            doc = PdfReader(io.BytesIO(data))
            for page in doc.pages:
                writer.add_page(page)
            page_count = len(doc.pages)
        else:
            page_bytes = image_to_letter_pdf(data)
            writer.add_page(PdfReader(io.BytesIO(page_bytes)).pages[0])
            page_count = 1

        manifest.append({
            "attachmentId": row["id"],
            "kind": row["kind"],
            "fileName": row.get("file_name"),
            "pageCount": page_count,
            "firstPage": first_page,
        })

    out = io.BytesIO()
    writer.write(out)
    merged = out.getvalue()

    total_pages = len(writer.pages)
    if total_pages >= _WARN_PAGE_COUNT or len(merged) >= _WARN_OUTPUT_BYTES:
        # Warn, never block (§7): the last step before a client-facing send must
        # not refuse a document a rep deliberately assembled.
        logger.warning(
            "Proposal documents for estimate %s produced a large output: "
            "%d total pages, %d bytes, %d appended documents",
            estimate_id, total_pages, len(merged), len(manifest),
        )

    return merged, manifest


def download_bytes(object_key: str) -> bytes:
    """Read a stored object's bytes from GCS.

    Thin wrapper so tests can patch a single seam. Delegates to api.attachments,
    which owns the bucket + signing config the rest of the app uses.
    """
    from api import attachments

    blob = attachments._gcs().bucket(attachments.GCS_ATTACHMENTS_BUCKET).blob(object_key)
    return blob.download_as_bytes()
