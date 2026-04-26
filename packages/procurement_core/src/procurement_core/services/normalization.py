from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

from procurement_core.models.orm import ExtractedItemRaw
from procurement_core.services.item_identity import (
    build_canonical_item_key,
    canonicalize_description as identity_canonicalize_description,
    normalize_item_number,
    raw_item_number_from_evidence,
)

UNIT_MAP = {
    "und": "unidad",
    "unidad": "unidad",
    "un": "unidad",
    "u": "unidad",
    "caja": "caja",
    "kg": "kilogramo",
    "kilo": "kilogramo",
    "mt": "metro",
    "m": "metro",
}


def _all_groups_are_thousands(groups: list[str]) -> bool:
    if len(groups) <= 1:
        return False
    if not groups[0] or len(groups[0]) > 3:
        return False
    return all(len(group) == 3 for group in groups[1:])


def parse_decimal(value: str | None) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    normalized_text = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode("ascii")
    normalized_text = normalized_text.replace("cop", "").replace("usd", "").replace("eur", "")
    if re.search(r"[a-z]", normalized_text):
        return None
    cleaned = re.sub(r"[^\d,\.\-]", "", text)
    if not cleaned:
        return None
    if cleaned.count(".") > 1 and cleaned.count(",") == 0:
        groups = cleaned.split(".")
        if _all_groups_are_thousands(groups):
            cleaned = "".join(groups)
    elif cleaned.count(",") > 1 and cleaned.count(".") == 0:
        groups = cleaned.split(",")
        if _all_groups_are_thousands(groups):
            cleaned = "".join(groups)
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif cleaned.count(".") == 1 and cleaned.count(",") == 0:
        integer_part, decimal_part = cleaned.split(".")
        cleaned = integer_part + decimal_part if len(decimal_part) == 3 else cleaned
    elif cleaned.count(",") == 1 and cleaned.count(".") == 0:
        integer_part, decimal_part = cleaned.split(",")
        cleaned = integer_part + decimal_part if len(decimal_part) == 3 else cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def normalize_unit(unit: str | None) -> str | None:
    if not unit:
        return None
    normalized = re.sub(r"[^a-z0-9]+", " ", unit.strip().lower()).strip()
    return UNIT_MAP.get(normalized, normalized or None)


def canonicalize_description(description: str) -> str:
    normalized = identity_canonicalize_description(description)
    return normalized or ""


def detect_vat_mode(raw_tax_note: str | None, raw_description: str) -> str:
    haystack = f"{raw_tax_note or ''} {raw_description}".lower()
    if "iva incluido" in haystack:
        return "vat_included"
    if "sin iva" in haystack or "iva excluido" in haystack:
        return "vat_excluded"
    return "unknown"


def normalize_raw_item(raw_item: ExtractedItemRaw) -> dict[str, object]:
    raw_item_number = raw_item_number_from_evidence(raw_item.evidence_json)
    canonical_key = build_canonical_item_key(
        raw_description=raw_item.raw_description,
        raw_item_number=raw_item_number,
        lot=raw_item.lot,
    )
    quantity_num = parse_decimal(raw_item.raw_quantity)
    unit_price_cop = parse_decimal(raw_item.raw_unit_price)
    total_cop = parse_decimal(raw_item.raw_total)
    derived_unit_price = False
    derived_total = False
    if unit_price_cop is None and quantity_num not in (None, Decimal("0")) and total_cop is not None:
        unit_price_cop = total_cop / quantity_num
        derived_unit_price = True
    if total_cop is None and quantity_num is not None and unit_price_cop is not None:
        total_cop = quantity_num * unit_price_cop
        derived_total = True
    return {
        "normalized_description": raw_item.raw_description.strip() if raw_item.raw_description else None,
        "quantity_num": quantity_num,
        "unit_normalized": normalize_unit(raw_item.raw_unit),
        "unit_price_cop": unit_price_cop,
        "total_cop": total_cop,
        "vat_mode": detect_vat_mode(raw_item.raw_tax_note, raw_item.raw_description),
        "presentation_detected": None,
        "brand_detected": None,
        "model_detected": None,
        "lot_normalized": raw_item.lot.strip() if raw_item.lot else None,
        "canonical_item_key": canonical_key,
        "metadata_json": {
            "normalization_version": 2,
            "item_number": raw_item_number,
            "item_number_normalized": normalize_item_number(raw_item_number),
            "derived_unit_price_from_total": derived_unit_price,
            "derived_total_from_unit_price": derived_total,
            "financial_basis_role": (raw_item.evidence_json or {}).get("financial_basis_role"),
            "financial_basis_reason": (raw_item.evidence_json or {}).get("financial_basis_reason"),
        },
    }
