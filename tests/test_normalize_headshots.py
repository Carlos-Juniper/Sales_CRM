"""TDD tests for scripts/normalize_headshots.py

Run: python -m pytest tests/test_normalize_headshots.py -v
"""
from __future__ import annotations

import pytest
from scripts.normalize_headshots import normalize_headshot_name, slugify_name


def test_strip_headshot_2026_suffix():
    assert normalize_headshot_name('John Smith - Headshot 2026') == 'headshot-john-smith'


def test_strip_headshot_suffix_no_year():
    assert normalize_headshot_name('John Smith - Headshot') == 'headshot-john-smith'


def test_strip_headshot_no_dash():
    assert normalize_headshot_name('John Smith Headshot 2026') == 'headshot-john-smith'


def test_strip_branch_then_headshot():
    assert normalize_headshot_name('Alberto Toucet - Fort Myers Headshot') == 'headshot-alberto-toucet'


def test_strip_sports_turf_headshot():
    assert normalize_headshot_name('Ricardo Peraza - Riviera Beach Sports Turf Headshot') == 'headshot-ricardo-peraza'


def test_strip_davie_headshot():
    assert normalize_headshot_name('Tom Jacob - Davie Headshot') == 'headshot-tom-jacob'


def test_rod_leon_remapped_to_rodrigo():
    # Rod Leon should become rodrigo-leon to match the corrected DB name (W2 migration)
    assert normalize_headshot_name('Rod Leon - Headshot 2026') == 'headshot-rodrigo-leon'


def test_diedra_calloway_corrected():
    # Diedra (filename) → Deidra (DB name) — transposed i/e in first name
    assert normalize_headshot_name('Diedra Calloway - Headshot 2026') == 'headshot-deidra-calloway'


def test_plain_name_headshot():
    assert normalize_headshot_name('Michelle Cady Headshot') == 'headshot-michelle-cady'


def test_slugify_name_basic():
    assert slugify_name('Jane Doe') == 'jane-doe'


def test_slugify_name_special_chars():
    assert slugify_name("O'Brien") == 'o-brien'


def test_slugify_name_extra_spaces():
    assert slugify_name('  Dan  Demont  ') == 'dan-demont'
