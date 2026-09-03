"""JSON-serialization helpers shared across API modules.

aiomysql returns Python-typed column values: DECIMAL columns come back as
``decimal.Decimal`` and DATETIME/DATE columns come back as ``datetime``/``date``
objects.  Neither is JSON-serializable by default, so any endpoint that does
``return dict(row)`` will 500 if those types are present.

``coerce_row`` is the single canonical coercion pass.  Import and call it
before returning any raw DB row dict.
"""
from __future__ import annotations

import datetime as _dt
from decimal import Decimal
from typing import Any


def coerce_row(row: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of *row* with non-JSON-serializable values coerced.

    Coercions applied:
      * ``Decimal``            → ``float``
      * ``datetime``/``date`` → ISO-8601 string via ``.isoformat()``
      * All other types       → passed through unchanged.

    This is intentionally column-name-agnostic: it inspects the value type, not
    the key name, so it is safe to call on any DB row regardless of schema.
    """
    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, (_dt.datetime, _dt.date)):
            # datetime subclasses date, so datetime must be checked first.
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out
