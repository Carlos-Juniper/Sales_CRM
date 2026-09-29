"""users.avatar_initials derivation, shared by every path that inserts a user.

The column is VARCHAR(5) NOT NULL with no default
(sql/migrations/004_users_and_branches.sql), so an INSERT that omits it fails
under strict mode with ERROR 1364. The admin authorize endpoint and both seed
scripts call this one helper so they cannot drift.
"""
from __future__ import annotations


def avatar_initials(name: str, email: str = "") -> str:
    """First letter of the first two words of *name*, uppercased.

    A blank name falls back to the email's first letter, then to "?", so the
    NOT NULL column never gets an empty string.
    """
    initials = "".join(word[0] for word in name.split()[:2]).upper()
    return initials or email.strip()[:1].upper() or "?"
