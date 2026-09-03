"""Beam / Attentive takeoff integration.

Covers the three things that would cost real money or real accuracy if they
regressed:

  * Unit handling — convert within a dimension, refuse across one. An
    acres-vs-square-feet mix-up on the maintenance side once produced errors of
    several orders of magnitude on a single property.
  * The spend gate — generate is estimator-only, idempotent, and unreachable
    from the callback and sweep paths.
  * Apply-vs-flag — a priced estimate or a hand-edited section is never
    silently overwritten by a later Attentive delivery.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest  # noqa: F401  (asyncio_mode=auto)
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api import beam_sync  # noqa: E402
from api.beam_routes import _editor_url  # noqa: E402
from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

_ESTIMATOR = {
    "id": "u1", "sub": "u1", "name": "Esti Mator", "email": "e@x.com",
    "role": "install_estimating", "branch_id": "Raleigh", "avatar_initials": "EM",
}
_SALES = {
    "id": "u2", "sub": "u2", "name": "Sally Sales", "email": "s@x.com",
    "role": "sales", "branch_id": "Raleigh", "avatar_initials": "SS",
}


@pytest.fixture
def estimator():
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def sales():
    app.dependency_overrides[require_auth] = lambda: _SALES
    yield
    app.dependency_overrides.clear()


# ── Units ────────────────────────────────────────────────────────────────────

class TestUnitConversion:
    def test_square_feet_to_acres(self):
        assert beam_sync.convert(43560, "sq ft", "acres") == pytest.approx(1.0)
        assert beam_sync.convert(21780, "sq ft", "acres") == pytest.approx(0.5)

    def test_feet_to_miles(self):
        assert beam_sync.convert(5280, "ft", "miles") == pytest.approx(1.0)

    def test_round_trips(self):
        sqft = 137_500.0
        acres = beam_sync.convert(sqft, "sq ft", "acres")
        assert beam_sync.convert(acres, "acres", "sq ft") == pytest.approx(sqft)

    def test_area_to_length_is_rejected_not_coerced(self):
        with pytest.raises(beam_sync.DimensionMismatch):
            beam_sync.convert(1000, "sq ft", "ft")
        with pytest.raises(beam_sync.DimensionMismatch):
            beam_sync.convert(1000, "ft", "acres")

    def test_unknown_unit_is_surfaced_not_guessed(self):
        with pytest.raises(beam_sync.UnknownUnit):
            beam_sync.convert(1, "hectare", "acres")

    def test_unit_strings_are_case_and_space_insensitive(self):
        assert beam_sync.convert(43560, " SQ FT ", "Acres") == pytest.approx(1.0)


class TestFeatureMap:
    def test_linear_features_never_target_square_feet(self):
        for name in ("Hard Edge", "Soft Edge"):
            mapping = beam_sync.mapping_for(name)
            assert mapping is not None
            assert mapping.target != beam_sync.SECTION_SQUARE_FEET

    def test_unknown_feature_returns_none_rather_than_a_default(self):
        assert beam_sync.mapping_for("Bollard Count") is None


class TestGrouping:
    def _row(self, feature, value, unit, measurement="area"):
        return {
            "id": f"o-{feature}", "feature_name": feature, "measurement_name": measurement,
            "value": value, "unit": unit,
        }

    def test_areas_sum_into_their_group(self):
        groups, unmapped = beam_sync._group([
            self._row("Mulch Bed", 10_000, "sq ft"),
            self._row("Gravel Bed", 5_000, "sq ft"),
        ])
        assert unmapped == []
        assert sum(e["value"] for e in groups["Beds"]) == pytest.approx(15_000)

    def test_acre_input_is_converted_not_written_raw(self):
        groups, _ = beam_sync._group([self._row("Lawn", 2, "acres")])
        assert groups["Turf"][0]["value"] == pytest.approx(87_120)

    def test_unmapped_feature_is_reported_never_dropped_or_zeroed(self):
        groups, unmapped = beam_sync._group([self._row("Catch Basin", 4, "count")])
        assert groups == {}
        assert [u.feature_name for u in unmapped] == ["Catch Basin"]

    def test_linear_feature_is_excluded_from_square_feet_and_is_not_unmapped(self):
        groups, unmapped = beam_sync._group([
            self._row("Hard Edge", 900, "ft", measurement="length")
        ])
        assert groups == {}
        assert unmapped == []


# ── Editor link ──────────────────────────────────────────────────────────────

_APP_HOSTS = {
    "ATTENTIVE_APP_URL": "https://app.attentive.ai/",
    "ATTENTIVE_STAGE_APP_URL": "https://aerial-stage.app.attentive.ai/",
}


class TestEditorLink:
    def test_link_follows_beam_env(self):
        """A stage request id does not resolve on the prod app, so the host must track BEAM_ENV."""
        with patch.dict(os.environ, {**_APP_HOSTS, "BEAM_ENV": "stage"}):
            assert _editor_url("att-99") == "https://aerial-stage.app.attentive.ai/request/att-99"
        with patch.dict(os.environ, {**_APP_HOSTS, "BEAM_ENV": "prod"}):
            assert _editor_url("att-99") == "https://app.attentive.ai/request/att-99"

    def test_no_link_without_a_request_at_attentive(self):
        with patch.dict(os.environ, _APP_HOSTS):
            assert _editor_url(None) is None

    def test_missing_app_host_hides_the_link_rather_than_erroring(self):
        with patch.dict(os.environ, {"ATTENTIVE_APP_URL": "", "BEAM_ENV": "prod"}):
            assert _editor_url("att-99") is None


# ── Spend gate ───────────────────────────────────────────────────────────────

_DRAFT_ROW = {
    "id": "br-1", "property_id": "p-1", "estimate_id": "e-1",
    "attentive_request_id": "att-99", "status": "draft", "cost_cents": 4200,
    "eta_seconds": 3600, "parcel_area_sqft": None, "address": "1 Main St",
    "submitted_at": None, "completed_at": None,
    "beam_sync_status": "pending", "beam_sync_error": None,
}


class TestSpendGate:
    def test_non_estimator_cannot_reach_generate(self, sales):
        with patch("api.beam_routes.query", new=AsyncMock(return_value=[_DRAFT_ROW])):
            res = client.post("/api/estimating/beam/requests/br-1/generate")
        assert res.status_code == 403

    def test_already_submitted_request_does_not_order_again(self, estimator):
        submitted = {**_DRAFT_ROW, "submitted_at": "2026-08-31T12:00:00", "status": "queued"}
        with patch("api.beam_routes.query", new=AsyncMock(return_value=[submitted])), \
             patch("api.beam_routes.BeamClient") as fake_client:
            res = client.post("/api/estimating/beam/requests/br-1/generate")
        assert res.status_code == 200
        fake_client.assert_not_called()

    def test_generate_orders_with_the_provisioned_report_type(self, estimator):
        fake = AsyncMock()
        fake.get_report_types.return_value = [{"id": "rep-1", "name": "Softscapes only"}]
        with patch("api.beam_routes.query", new=AsyncMock(return_value=[_DRAFT_ROW])), \
             patch("api.beam_routes.execute", new=AsyncMock()), \
             patch("api.beam_routes.BeamClient") as ctor:
            ctor.return_value.__aenter__.return_value = fake
            res = client.post("/api/estimating/beam/requests/br-1/generate")
        assert res.status_code == 200
        fake.generate_request.assert_awaited_once_with(
            _DRAFT_ROW["attentive_request_id"], address=_DRAFT_ROW["address"], report_id="rep-1"
        )

    def test_the_callback_path_can_never_order(self):
        """A callback must be able to trigger an ingest but never a purchase."""
        generate = AsyncMock()
        with patch.dict(os.environ, {"ATTENTIVE_WEBHOOK_TOKEN": "right"}), \
             patch("api.beam_routes.query", new=AsyncMock(return_value=[{"id": "br-1"}])), \
             patch("api.beam_sync.ingest_request", new=AsyncMock()), \
             patch("api.beam_client.BeamClient.generate_request", new=generate):
            client.post("/webhooks/attentive?token=right", json={"data": {"request_id": "att-99"}})
        generate.assert_not_awaited()

    async def test_the_sweeper_can_never_order(self):
        generate = AsyncMock()
        with patch.dict(os.environ, {"BEAM_SYNC_ENABLED": "true"}), \
             patch("api.beam_sync.query", new=AsyncMock(return_value=[{"id": "br-1"}])), \
             patch("api.beam_sync.ingest_request", new=AsyncMock()), \
             patch("api.beam_client.BeamClient.generate_request", new=generate):
            await beam_sync.sweep_once()
        generate.assert_not_awaited()


# ── Callback ─────────────────────────────────────────────────────────────────

class TestCallback:
    def test_bad_token_is_rejected(self):
        with patch.dict(os.environ, {"ATTENTIVE_WEBHOOK_TOKEN": "right"}):
            res = client.post("/webhooks/attentive?token=wrong", json={"data": {"request_id": "att-99"}})
        assert res.status_code == 403

    def test_missing_configured_token_rejects_everything(self):
        with patch.dict(os.environ, {"ATTENTIVE_WEBHOOK_TOKEN": ""}):
            res = client.post("/webhooks/attentive?token=", json={"data": {"request_id": "att-99"}})
        assert res.status_code == 403

    def test_forged_measurements_in_the_body_are_ignored(self):
        """Only request_id is read; measurements are re-fetched with our own token."""
        ingest = AsyncMock()
        with patch.dict(os.environ, {"ATTENTIVE_WEBHOOK_TOKEN": "right"}), \
             patch("api.beam_routes.query", new=AsyncMock(return_value=[{"id": "br-1"}])), \
             patch("api.beam_sync.ingest_request", new=ingest):
            res = client.post(
                "/webhooks/attentive?token=right",
                json={
                    "data": {
                        "request_id": "att-99",
                        "outputs": [{"feature": {"name": "Lawn"}, "measurements": [
                            {"name": "area", "value": 999_999_999, "unit": "acres"}
                        ]}],
                    },
                    "event": "request_complete",
                },
            )
        assert res.status_code == 200
        ingest.assert_awaited_once_with("br-1")

    def test_unknown_request_is_a_noop(self):
        with patch.dict(os.environ, {"ATTENTIVE_WEBHOOK_TOKEN": "right"}), \
             patch("api.beam_routes.query", new=AsyncMock(return_value=[])):
            res = client.post("/webhooks/attentive?token=right", json={"data": {"request_id": "nope"}})
        assert res.status_code == 200
        assert res.json()["ignored"] == "unknown request"


# ── Apply vs flag ────────────────────────────────────────────────────────────

class TestApplyOrFlag:
    async def _run(self, estimate_status: str, outputs: list[dict]):
        calls: list[tuple[str, list]] = []

        async def fake_query(sql, params=None):
            if "FROM estimates" in sql:
                return [{"id": "e-1", "status": estimate_status}]
            if "FROM beam_outputs o" in sql:
                return outputs
            if "MAX(sort_order)" in sql:
                return [{"next": 0}]
            return []

        async def fake_execute(sql, params=None):
            calls.append((" ".join(sql.split()), list(params or [])))

        with patch("api.beam_sync.query", new=fake_query), \
             patch("api.beam_sync.execute", new=fake_execute):
            result = await beam_sync._apply_or_flag({"estimate_id": "e-1"}, "br-1")
        return result, calls

    async def test_priced_estimate_is_flagged_not_overwritten(self):
        result, calls = await self._run("priced", [
            {"id": "o1", "feature_name": "Lawn", "measurement_name": "area",
             "value": 10_000, "unit": "sq ft"},
        ])
        assert result.flagged is True
        assert result.sections_applied == 0
        assert any("takeoff_changed_at" in sql for sql, _ in calls)
        assert not any("estimate_sections SET square_feet" in sql for sql, _ in calls)

    async def test_unpriced_estimate_creates_the_section(self):
        result, calls = await self._run("queued", [
            {"id": "o1", "feature_name": "Lawn", "measurement_name": "area",
             "value": 10_000, "unit": "sq ft"},
        ])
        assert result.sections_applied == 1
        assert any("INSERT INTO estimate_sections" in sql for sql, _ in calls)

    async def test_unmapped_features_reach_the_caller(self):
        result, _ = await self._run("queued", [
            {"id": "o1", "feature_name": "Light Pole", "measurement_name": "count",
             "value": 12, "unit": "count"},
        ])
        assert [u.feature_name for u in result.unmapped] == ["Light Pole"]


class TestHandEditedSection:
    async def _apply(self, existing_sqft: float, previously_applied):
        calls: list[str] = []

        async def fake_query(sql, params=None):
            if "FROM estimate_sections WHERE estimate_id" in sql:
                return [{"id": "sec-1", "square_feet": existing_sqft}]
            if "SUM(applied_value)" in sql:
                return [{"total": previously_applied}]
            return []

        async def fake_execute(sql, params=None):
            calls.append(" ".join(sql.split()))

        with patch("api.beam_sync.query", new=fake_query), \
             patch("api.beam_sync.execute", new=fake_execute):
            applied = await beam_sync._apply_group(
                "e-1", "Turf", [{"row": {"id": "o1"}, "value": 12_000.0}]
            )
        return applied, calls

    async def test_section_matching_our_last_write_is_updated(self):
        applied, calls = await self._apply(existing_sqft=10_000.0, previously_applied=10_000.0)
        assert applied is True
        assert any("UPDATE estimate_sections SET square_feet" in c for c in calls)

    async def test_hand_edited_section_is_never_overwritten(self):
        applied, calls = await self._apply(existing_sqft=11_500.0, previously_applied=10_000.0)
        assert applied is False
        assert not any("UPDATE estimate_sections SET square_feet" in c for c in calls)

    async def test_estimator_authored_section_beam_never_touched_is_left_alone(self):
        applied, calls = await self._apply(existing_sqft=8_000.0, previously_applied=None)
        assert applied is False
        assert not any("UPDATE estimate_sections SET square_feet" in c for c in calls)


class TestSyncDisabled:
    async def test_ingest_is_a_noop_when_sync_is_off(self):
        with patch.dict(os.environ, {"BEAM_SYNC_ENABLED": "false"}):
            result = await beam_sync.ingest_request("br-1")
        assert result.status == "disabled"
