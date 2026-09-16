"""Contract-generator billing type resolution on `_service_out`.

`_service_out` had no test at all, which is how it shipped with a call site
passing three arguments to a two-argument signature — a TypeError that took
down BOTH estimate read paths (list and detail), since `_load_estimate` is the
shared loader behind them. The first test here is that regression.

The rest cover the per-line billing_type override added in migration 046:
NULL on the line derives from the catalog item; a non-NULL value always wins.

Resolving to None is not a failure state here — all maintenance work bundles
into the 12-month contract, and contract.ts treats anything not explicitly
one_time as recurring. The override exists to mark the exception.

Pure serializer, so no DB and no FastAPI client — just rows in, dict out.
"""
from __future__ import annotations

import os

import pytest  # noqa: F401  (asyncio_mode=auto)

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")

from api.estimating import _service_out  # noqa: E402


def make_row(**overrides) -> dict:
    """A section_services row with every column _service_out reads."""
    row = {
        "id": "svc-1",
        "section_id": "sec-1",
        "catalog_item_id": "kit-maint-1",
        "discipline": None,
        "billing_type": None,
        "label": "Mowing & Edging",
        "qty": 12,
        "uom": "/yr",
        "complexity_pct": 0,
        "unit_sell_cents": 350,
        "embedded_cost_cents": None,
        "target_gm": None,
        "hours": None,
        "sort_order": 0,
    }
    row.update(overrides)
    return row


class TestServiceOutSignature:
    def test_accepts_catalog_data_as_third_argument(self):
        """Regression: _load_estimate passes catalog_data positionally."""
        out = _service_out(make_row(), [], {"billing_type": "recurring"})
        assert out["label"] == "Mowing & Edging"

    def test_catalog_data_is_optional(self):
        """The four single-row routes call it with two arguments."""
        out = _service_out(make_row(), [])
        assert out["billingType"] is None
        assert out["scopeText"] is None
        assert out["serviceType"] is None


class TestBillingTypeResolution:
    def test_derives_from_catalog_item_when_line_has_no_override(self):
        out = _service_out(make_row(billing_type=None), [], {"billing_type": "recurring"})
        assert out["billingType"] == "recurring"

    def test_line_override_wins_over_catalog_item(self):
        out = _service_out(
            make_row(billing_type="one_time"), [], {"billing_type": "recurring"}
        )
        assert out["billingType"] == "one_time"

    def test_hand_entered_line_resolves_from_its_own_override(self):
        """No catalog item to derive from — the override is the only source."""
        out = _service_out(
            make_row(catalog_item_id=None, billing_type="recurring"), [], None
        )
        assert out["billingType"] == "recurring"

    def test_hand_entered_line_without_override_is_unresolved(self):
        """Stays None; contract.ts then bundles it as recurring."""
        out = _service_out(make_row(catalog_item_id=None, billing_type=None), [], None)
        assert out["billingType"] is None

    def test_scope_text_and_service_type_still_come_from_the_catalog(self):
        """Only billing_type is overridable per line; the other two are not."""
        out = _service_out(
            make_row(billing_type="one_time"),
            [],
            {"billing_type": "recurring", "scope_text": "Juniper will mow…", "service_type": "Turf Area"},
        )
        assert out["scopeText"] == "Juniper will mow…"
        assert out["serviceType"] == "Turf Area"
