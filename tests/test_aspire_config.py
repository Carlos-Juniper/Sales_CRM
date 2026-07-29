"""Tests for api/aspire_config.py — vendored Aspire lookup constants (pure data).

These pin the exact ids captured live from the Aspire tenant (2026-07-27) so a
silent drift in a copied map is caught before it reaches a real write.
"""
from api import aspire_config as cfg


class TestOpportunityStatusIds:
    def test_new_won_lost_ids(self):
        assert cfg.ASPIRE_OPPORTUNITY_STATUS_NEW == 1652
        assert cfg.ASPIRE_OPPORTUNITY_STATUS_WON == 1658
        assert cfg.ASPIRE_OPPORTUNITY_STATUS_LOST == 1659


class TestLostReasons:
    def test_only_active_reasons_present(self):
        assert cfg.ASPIRE_LOST_REASONS == {
            13: "Price",
            14: "Quality / Reputation",
            15: "Relationship",
        }

    def test_deprecated_reasons_excluded(self):
        # 2,4,6,8,10,12 were deactivated 2025-02-13 — never write them.
        for dead in (2, 4, 6, 8, 10, 12):
            assert dead not in cfg.ASPIRE_LOST_REASONS


class TestDivisionMap:
    def test_all_eight_service_lines(self):
        assert cfg.ASPIRE_DIVISION_MAP == {
            "Maintenance: Contract": 1574,
            "Maintenance: Enhancements": 1570,
            "Maintenance: Irrigation Service": 1588,
            "Install: Landscape": 1569,
            "Install: Enhancements": 1576,
            "Install:  Hardscape": 2594,  # NB: real Aspire DivisionName has a double space
            "Install: Irrigation": 1577,
            "Install: Sod": 1578,
        }

    def test_hardscape_key_has_double_space(self):
        # Guard the easy-to-lose double space — a single-space key would KeyError
        # against the frontend service-line dropdown value.
        assert "Install:  Hardscape" in cfg.ASPIRE_DIVISION_MAP
        assert "Install: Hardscape" not in cfg.ASPIRE_DIVISION_MAP
        assert cfg.ASPIRE_DIVISION_MAP["Install:  Hardscape"] == 2594

    def test_install_division_ids_frozenset(self):
        assert cfg.ASPIRE_INSTALL_DIVISION_IDS == frozenset({1569, 1576, 2594, 1577, 1578})


class TestBranchMap:
    def test_sample_branch_ids(self):
        assert cfg.ASPIRE_BRANCH_MAP[("Orlando, FL", False)] == 3668
        assert cfg.ASPIRE_BRANCH_MAP[("Orlando, FL", True)] == 3579
        assert cfg.ASPIRE_BRANCH_MAP[("Raleigh, NC", True)] == 3689

    def test_install_fallbacks_present(self):
        assert "Sarasota, FL" in cfg.ASPIRE_BRANCH_INSTALL_FALLBACKS
        assert "Wilmington, NC" in cfg.ASPIRE_BRANCH_INSTALL_FALLBACKS


class TestSalesAndLeadSourceMaps:
    def test_sales_type_map(self):
        assert cfg.ASPIRE_SALES_TYPE_MAP["HOA"] == 1684
        assert cfg.ASPIRE_SALES_TYPE_MAP["commercial"] == 1680

    def test_lead_source_map(self):
        assert cfg.ASPIRE_LEAD_SOURCE_MAP["manual"] == 2117


class TestWriteBehaviourConstants:
    def test_status_write_verb_defaults_to_patch(self):
        # Unverified live — build defensively, flip after a real write test.
        assert cfg.ASPIRE_STATUS_WRITE_VERB == "PATCH"

    def test_opportunity_type_default_defined(self):
        # Mirrors the proven batch value; flagged for live confirmation.
        assert isinstance(cfg.ASPIRE_OPPORTUNITY_TYPE_DEFAULT, str)
