"""Strip stray numeric hash suffixes from catalog and line labels.

``Additional Pruning #5`` is a catalog name, not a fifth pruning service.
The same cleaner runs on seed, pull, read, and write so a re-seed cannot
put the suffix back. ``None`` stays ``None`` (a null display name is not
an empty string).
"""
from __future__ import annotations

import re

# Whitespace plus a # and digits at a word boundary, anywhere in the label.
_HASH_SUFFIX = re.compile(r"\s*#\d+\b")
_WHITESPACE = re.compile(r"\s+")


def catalog_label(value: str | None) -> str | None:
    """Remove every ``#<digits>`` suffix and collapse leftover whitespace."""
    if value is None:
        return None
    text = _HASH_SUFFIX.sub("", value)
    return _WHITESPACE.sub(" ", text).strip()
