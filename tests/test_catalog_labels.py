"""Catalog labels lose stray `#<digits>` suffixes, and seed emitters never write one."""
from __future__ import annotations

import ast
import re
import sys
import tokenize
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from api.catalog_labels import catalog_label  # noqa: E402
from scripts import load_service_catalog as L  # noqa: E402

# String literals only. SQL `--` comments and Python `#` comments name Aspire
# rows such as "Bid Item #1" that this migration deactivates; they are not
# stored labels. Migration 083's WHERE clause names the suffix on purpose
# and is not a seed emitter.
_SQL_SOURCES = (
    REPO / "sql" / "migrations" / "009_seed_catalog_items.sql",
    REPO / "sql" / "migrations" / "075_maintenance_service_catalog.sql",
    REPO / "sql" / "migrations" / "082_maintenance_catalog_curation.sql",
)
_PYTHON_SOURCES = (
    REPO / "api" / "maintenance_catalog.py",
    REPO / "scripts" / "load_service_catalog.py",
    REPO / "scripts" / "pull_aspire_service_catalog.py",
)
_SQL_QUOTED = re.compile(r"'([^']*)'")
_HASH_NUMBER = re.compile(r"#\d")


def _sql_literals(path: Path) -> list[str]:
    text = re.sub(r"--.*?$", "", path.read_text(encoding="utf-8"), flags=re.M)
    return [match.group(1) for match in _SQL_QUOTED.finditer(text)]


def _python_literals(path: Path) -> list[str]:
    literals: list[str] = []
    with path.open("rb") as handle:
        for tok in tokenize.tokenize(handle.readline):
            if tok.type != tokenize.STRING:
                continue
            try:
                value = ast.literal_eval(tok.string)
            except (SyntaxError, ValueError):
                continue
            if isinstance(value, str):
                literals.append(value)
    return literals


def test_catalog_label_strips_additional_pruning_suffix():
    assert catalog_label("Additional Pruning #5") == "Additional Pruning"
    assert catalog_label("Additional pruning #5") == "Additional pruning"
    assert catalog_label("Mulch") == "Mulch"
    assert catalog_label(None) is None


def test_install_display_name_strips_hash_suffix_after_in_prefix():
    assert L.display_name({"name": "IN: Additional Pruning #5", "display_name": None}) == (
        "Additional Pruning"
    )
    assert L.display_name({"name": "IN:  Parts", "display_name": "IN:  Irrigation  Parts"}) == (
        "Irrigation Parts"
    )


def test_seed_labels_do_not_match_hash_number():
    bad: list[str] = []
    sources = [(path, _sql_literals(path)) for path in _SQL_SOURCES]
    sources += [(path, _python_literals(path)) for path in _PYTHON_SOURCES]
    for path, literals in sources:
        for literal in literals:
            if _HASH_NUMBER.search(literal):
                bad.append(f"{path.relative_to(REPO)}: {literal}")
    assert bad == []
