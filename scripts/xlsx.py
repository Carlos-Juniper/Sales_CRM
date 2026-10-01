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


# ── writer ────────────────────────────────────────────────────────────────────

def _col_letter(idx: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA."""
    out = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        out = chr(65 + rem) + out
    return out


def _xml_text(value: str) -> str:
    # Drop characters XML 1.0 cannot carry, then escape.
    cleaned = "".join(ch for ch in value if ch in "\t\n\r" or ord(ch) >= 0x20)
    return (
        cleaned.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _sheet_xml(rows: list[list]) -> str:
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        "<sheetData>",
    ]
    for r_idx, row in enumerate(rows, start=1):
        cells = []
        for c_idx, value in enumerate(row):
            if value is None or value == "":
                continue
            ref = f"{_col_letter(c_idx)}{r_idx}"
            if isinstance(value, bool):
                cells.append(f'<c r="{ref}" t="b"><v>{int(value)}</v></c>')
            elif isinstance(value, (int, float)):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cells.append(
                    f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">'
                    f"{_xml_text(str(value))}</t></is></c>"
                )
        out.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
    out.append("</sheetData></worksheet>")
    return "".join(out)


def write_workbook(path, sheets: dict[str, list[list]]) -> None:
    """Write a minimal xlsx (inline strings, no styles) with one sheet per entry.

    Stdlib only, like the reader. Sheet names are truncated to Excel's 31
    characters; values may be str, int, float, bool or None.
    """
    names = [name[:31] for name in sheets]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + "".join(
                f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                for i in range(1, len(names) + 1)
            )
            + "</Types>",
        )
        z.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>",
        )
        z.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            + "".join(
                f'<sheet name="{_xml_text(n)}" sheetId="{i}" r:id="rId{i}"/>'
                for i, n in enumerate(names, start=1)
            )
            + "</sheets></workbook>",
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(
                f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                for i in range(1, len(names) + 1)
            )
            + "</Relationships>",
        )
        for i, rows in enumerate(sheets.values(), start=1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", _sheet_xml(rows))
