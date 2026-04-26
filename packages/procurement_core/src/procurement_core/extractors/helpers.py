from __future__ import annotations

import re
import unicodedata
from decimal import Decimal
from typing import Any

from procurement_core.models.enums import ExtractionMethod
from procurement_core.schemas.extraction import RawItemCandidate

HEADER_ALIASES = {
    "item_number": {"item", "item no", "item nro", "numero item", "no item", "n item", "# item", "item #"},
    "description": {"descripcion", "detalle", "producto", "servicio"},
    "quantity": {"cantidad", "cant", "cant.", "qty"},
    "unit": {"unidad", "u.m", "um", "unidad medida", "medida"},
    "unit_price": {"valor unitario", "precio unitario", "vr unitario", "unitario", "precio und"},
    "total": {"valor total", "precio total", "vr total", "total"},
    "lot": {"lote", "grupo"},
    "tax": {"iva", "impuesto"},
}

STRICT_ITEM_NUMBER_HEADERS = {
    "item",
    "item no",
    "item nro",
    "numero item",
    "no item",
    "n item",
    "# item",
    "item #",
    "n",
    "no",
    "nro",
    "numero",
    "n item",
}


def slug_header(value: Any) -> str:
    if value is None:
        return ""
    normalized = unicodedata.normalize("NFKD", str(value).strip().lower()).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()


def map_headers(row: list[Any]) -> dict[str, int]:
    mapped: dict[str, int] = {}
    for index, cell in enumerate(row):
        normalized = slug_header(cell)
        if not normalized:
            continue
        for key, aliases in HEADER_ALIASES.items():
            if key == "item_number":
                if (
                    normalized in STRICT_ITEM_NUMBER_HEADERS
                    or normalized.startswith("no ")
                    or normalized.startswith("numero ")
                    or normalized.startswith("nro ")
                    or normalized.startswith("item ")
                ):
                    mapped.setdefault(key, index)
                continue
            if normalized in aliases or any(alias in normalized for alias in aliases):
                mapped.setdefault(key, index)
    return mapped


def value_from_row(row: list[Any], header_map: dict[str, int], logical_name: str) -> Any | None:
    if logical_name not in header_map:
        return None
    index = header_map[logical_name]
    return row[index] if index < len(row) else None


def looks_numericish(value: Any) -> bool:
    if value is None:
        return False
    text = str(value).strip()
    if not text:
        return False
    compact = re.sub(r"[^\d,\.\-]", "", text)
    return bool(compact) and any(char.isdigit() for char in compact)


def _is_probable_total_row(description: str) -> bool:
    slug = slug_header(description)
    return slug in {"valor total", "subtotal", "total", "total general"} or slug.startswith("subtotal ")


def row_to_candidate(
    row: list[Any],
    header_map: dict[str, int],
    *,
    page_number: int | None = None,
    sheet_name: str | None = None,
    row_index: int | None = None,
    cell_range: str | None = None,
    method: ExtractionMethod,
) -> RawItemCandidate | None:
    description = value_from_row(row, header_map, "description")
    if not description:
        return None
    if _is_probable_total_row(str(description)):
        return None
    item_number = value_from_row(row, header_map, "item_number")
    qty = value_from_row(row, header_map, "quantity")
    unit = value_from_row(row, header_map, "unit")
    unit_price = value_from_row(row, header_map, "unit_price")
    total = value_from_row(row, header_map, "total")
    lot = value_from_row(row, header_map, "lot")
    tax = value_from_row(row, header_map, "tax")
    if not any(looks_numericish(value) for value in [qty, unit_price, total]):
        return None
    return RawItemCandidate(
        raw_item_number=str(item_number).strip() if item_number is not None else None,
        lot=str(lot).strip() if lot is not None else None,
        page_number=page_number,
        sheet_name=sheet_name,
        row_index=row_index,
        cell_range=cell_range,
        raw_description=str(description).strip(),
        raw_quantity=str(qty).strip() if qty is not None else None,
        raw_unit=str(unit).strip() if unit is not None else None,
        raw_unit_price=str(unit_price).strip() if unit_price is not None else None,
        raw_total=str(total).strip() if total is not None else None,
        raw_currency="COP",
        raw_tax_note=str(tax).strip() if tax is not None else None,
        extraction_method=method,
        extraction_confidence=Decimal("0.88"),
        evidence={
            "header_map": header_map,
            "item_number": str(item_number).strip() if item_number is not None else None,
        },
    )


LINE_PATTERN = re.compile(
    r"^(?:(?P<item>\d+(?:\.\d+)?)\s+)?(?P<description>.+?)\s{2,}(?P<qty>\d+(?:[\.,]\d+)?)\s+(?P<unit>[A-Za-z]+)\s+(?P<unit_price>[\d\.\,]+)\s+(?P<total>[\d\.\,]+)$"
)


def text_lines_to_candidates(text: str, *, page_number: int | None = None) -> list[RawItemCandidate]:
    candidates: list[RawItemCandidate] = []
    for line in text.splitlines():
        match = LINE_PATTERN.match(line.strip())
        if not match:
            continue
        groups = match.groupdict()
        candidates.append(
            RawItemCandidate(
                raw_item_number=groups.get("item"),
                page_number=page_number,
                raw_description=groups["description"].strip(),
                raw_quantity=groups["qty"],
                raw_unit=groups["unit"],
                raw_unit_price=groups["unit_price"],
                raw_total=groups["total"],
                raw_currency="COP",
                extraction_method=ExtractionMethod.RULE_ASSISTED,
                extraction_confidence=Decimal("0.62"),
                evidence={"line": line, "item_number": groups.get("item")},
            )
        )
    return candidates
