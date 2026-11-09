#!/usr/bin/env python3
"""Apply UX-focused styles to plantilla-simulador-financiero.xlsx.

This script intentionally uses only Python's standard library so it can run in the
current Node container without installing openpyxl at runtime.
"""

from __future__ import annotations

import re
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
ET.register_namespace("", NS)


def q(tag: str) -> str:
    return f"{{{NS}}}{tag}"


STYLES_XML = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="{NS}">
  <fonts count="5">
    <font><sz val="9"/><name val="Segoe UI"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
    <font><b/><sz val="9"/><color rgb="FF333333"/><name val="Segoe UI"/></font>
    <font><sz val="9"/><name val="Segoe UI"/></font>
    <font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Segoe UI"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF34495E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2980B9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF16A085"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF8E44AD"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F4"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD6EAF8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE0E0E0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>
'''


WIDTHS = {
    "A": 8,
    "B": 25,
    "C": 40,
    "D": 10,
    "E": 8,
    "F": 15,
    "G": 30,
    "H": 20,
    "I": 15,
    "J": 10,
    "K": 35,
    "L": 30,
    "M": 12,
    "N": 20,
    "O": 15,
    "P": 10,
    "Q": 35,
    "R": 30,
    "S": 12,
    "T": 20,
    "U": 15,
    "V": 10,
    "W": 35,
    "X": 30,
    "Y": 12,
    "Z": 19,
    "AA": 27,
    "AB": 20,
    "AC": 21,
    "AD": 25,
}
WRAP_COLS = set("CGKLQRWX") | {"AA"}
CENTER_COLS = set("ADEJPV") | {"Z", "AC", "AD"}
RIGHT_COLS = set("FIOU") | {"AB"}


def split_cell_ref(ref: str) -> tuple[str, int]:
    m = re.match(r"([A-Z]+)(\d+)", ref)
    if not m:
        return ref, 0
    return m.group(1), int(m.group(2))


def col_index(letter: str) -> int:
    total = 0
    for ch in letter:
        total = total * 26 + ord(ch) - 64
    return total


def style_for_cell(ref: str) -> str:
    letter, row = split_cell_ref(ref)
    col = col_index(letter)
    if row == 1:
        if col <= 7:
            return "1"
        if col <= 13:
            return "2"
        if col <= 19:
            return "3"
        return "4"
    if row == 2:
        return "5"
    if letter in WRAP_COLS:
        return "6"
    if letter in CENTER_COLS:
        return "7"
    if letter in RIGHT_COLS:
        return "8"
    return "9"


def ensure_child(parent: ET.Element, tag: str) -> ET.Element:
    found = parent.find(q(tag))
    if found is not None:
        return found
    child = ET.Element(q(tag))
    parent.append(child)
    return child


def style_sheet_xml(xml: bytes) -> bytes:
    root = ET.fromstring(xml)

    sheet_views = ensure_child(root, "sheetViews")
    sheet_view = sheet_views.find(q("sheetView"))
    if sheet_view is None:
        sheet_view = ET.SubElement(sheet_views, q("sheetView"), {"workbookViewId": "0"})
    sheet_view.set("showGridLines", "0")
    for child in list(sheet_view):
        if child.tag in {q("pane"), q("selection")}:
            sheet_view.remove(child)
    ET.SubElement(
        sheet_view,
        q("pane"),
        {"xSplit": "2", "ySplit": "2", "topLeftCell": "C3", "activePane": "bottomRight", "state": "frozen"},
    )
    ET.SubElement(sheet_view, q("selection"), {"pane": "bottomRight", "activeCell": "C3", "sqref": "C3"})

    old_cols = root.find(q("cols"))
    if old_cols is not None:
        root.remove(old_cols)
    cols = ET.Element(q("cols"))
    for letter, width in WIDTHS.items():
        idx = str(col_index(letter))
        ET.SubElement(cols, q("col"), {"min": idx, "max": idx, "width": str(width), "customWidth": "1"})

    children = list(root)
    sheet_format = root.find(q("sheetFormatPr"))
    if sheet_format is not None:
        insert_at = children.index(sheet_format) + 1
    else:
        sheet_views = root.find(q("sheetViews"))
        dimension = root.find(q("dimension"))
        if sheet_views is not None:
            insert_at = children.index(sheet_views) + 1
        elif dimension is not None:
            insert_at = children.index(dimension) + 1
        else:
            insert_at = 0
    root.insert(insert_at, cols)

    for row in root.findall(f".//{q('row')}"):
        row_index = int(row.get("r", "0"))
        if row_index == 1:
            row.set("ht", "22")
            row.set("customHeight", "1")
        elif row_index == 2:
            row.set("ht", "30")
            row.set("customHeight", "1")
        else:
            row.set("ht", "34")
            row.set("customHeight", "1")
        for cell in row.findall(q("c")):
            ref = cell.get("r", "")
            cell.set("s", style_for_cell(ref))

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def apply_styles(file_path: str) -> None:
    src = Path(file_path)
    tmp = Path(tempfile.mkstemp(suffix=".xlsx")[1])
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        written_styles = False
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                data = style_sheet_xml(data)
            elif item.filename == "xl/styles.xml":
                data = STYLES_XML.encode("utf-8")
                written_styles = True
            zout.writestr(item, data)
        if not written_styles:
            zout.writestr("xl/styles.xml", STYLES_XML.encode("utf-8"))
    tmp.replace(src)


def aplicar_estilos_plantilla(file_path: str) -> None:
    apply_styles(file_path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: style-template-xlsx.py <archivo.xlsx>")
    aplicar_estilos_plantilla(sys.argv[1])
