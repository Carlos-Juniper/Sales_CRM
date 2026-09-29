"""api.avatar.avatar_initials — the one derivation of users.avatar_initials."""
from __future__ import annotations

import pytest

from api.avatar import avatar_initials


@pytest.mark.parametrize(
    ("name", "email", "expected"),
    [
        ("Jane Doe", "jane.doe@example.com", "JD"),
        ("jane", "jane.doe@example.com", "J"),
        ("Mary Ann Smith", "", "MA"),
        ("  ", "zed@example.com", "Z"),
        ("", "", "?"),
    ],
)
def test_avatar_initials(name: str, email: str, expected: str) -> None:
    assert avatar_initials(name, email) == expected
