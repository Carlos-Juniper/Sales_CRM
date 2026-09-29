"""Stdlib xlsx reader shared by the catalog loaders.

xlsx is a zip of XML. Neither loader depends on openpyxl.
"""
from __future__ import annotations

import zipfile
from xml.etree import ElementTree as ET

_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return [
        "".join(t.text or "" for t in si.iter(_M + "t"))
        for si in root.findall(_M + "si")
    ]


def sheet_targets(z: zipfile.ZipFile) -> list[tuple[str, str]]:
    """Workbook sheet name and the zip path of its worksheet XML."""
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {rel.get("Id"): rel.get("Target") for rel in rels}
    out: list[tuple[str, str]] = []
    for sh in wb.findall(_M + "sheets/" + _M + "sheet"):
        name = sh.get("name") or ""
        target = (rid_to_target[sh.get(_REL + "id")] or "").lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        out.append((name, target))
    return out


def sheet_rows(
    z: zipfile.ZipFile, target: str, shared: list[str]
) -> list[tuple[int, dict[str, str | None]]]:
    """Rows as (sheet row number, column letter → cell text)."""
    root = ET.fromstring(z.read(target))
    rows: list[tuple[int, dict[str, str | None]]] = []
    for fallback, row in enumerate(root.iter(_M + "row"), start=1):
        raw_number = row.get("r") or ""
        number = int(raw_number) if raw_number.isdigit() else fallback
        vals: dict[str, str | None] = {}
        for cell in row:
            ref = cell.get("r") or ""
            col = "".join(ch for ch in ref if ch.isalpha())
            value = cell.find(_M + "v")
            inline = cell.find(_M + "is")
            if inline is not None:
                text: str | None = "".join(t.text or "" for t in inline.iter(_M + "t"))
            elif value is None or value.text is None:
                text = None
            elif cell.get("t") == "s":
                text = shared[int(value.text)]
            else:
                text = value.text
            if col:
                vals[col] = text
        rows.append((number, vals))
    return rows
