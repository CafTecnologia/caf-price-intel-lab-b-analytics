from __future__ import annotations

import re
from decimal import Decimal

from procurement_core.models.enums import IssueType, Severity
from procurement_core.models.orm import ExtractedItemNormalized, ExtractedItemRaw
from procurement_core.validation.base import ValidationContext, ValidationRule


def _has_complete_primary_sibling(
    raw_item: ExtractedItemRaw,
    context: ValidationContext,
) -> bool:
    for sibling_raw, sibling_normalized in context.siblings:
        if sibling_raw.id == raw_item.id:
            continue
        if sibling_raw.status != "primary":
            continue
        if (
            sibling_normalized.quantity_num is not None
            and sibling_normalized.unit_normalized
            and sibling_normalized.unit_price_cop is not None
            and sibling_normalized.total_cop is not None
        ):
            return True
    return False


def _parse_tax_rate(value: str | None) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    cleaned = re.sub(r"[^\d,\.\-]", "", text)
    if not cleaned:
        return None
    normalized = cleaned.replace(",", ".")
    try:
        parsed = Decimal(normalized)
    except Exception:
        return None
    if parsed > 1:
        parsed = parsed / Decimal("100")
    if parsed < 0 or parsed > 1:
        return None
    return parsed


def _is_priced_catalog_row(raw_item: ExtractedItemRaw, normalized_item: ExtractedItemNormalized) -> bool:
    metadata = normalized_item.metadata_json or {}
    item_number = metadata.get("item_number_normalized") or metadata.get("item_number")
    return bool(
        item_number
        and raw_item.raw_description
        and normalized_item.unit_price_cop is not None
        and normalized_item.total_cop is None
        and raw_item.raw_quantity
    )


class LowConfidenceRule(ValidationRule):
    rule_name = "low_confidence"

    def evaluate(
        self,
        raw_item: ExtractedItemRaw,
        normalized_item: ExtractedItemNormalized,
        context: ValidationContext,
    ) -> list[dict[str, object]]:
        if raw_item.extraction_confidence is None or raw_item.extraction_confidence >= Decimal("0.70"):
            return []
        return [
            {
                "issue_type": IssueType.LOW_CONFIDENCE,
                "severity": Severity.HIGH,
                "title": "Baja confianza de extraccion",
                "message": "El extractor reporto una confianza inferior al umbral configurado.",
                "suggested_value": None,
                "evidence_json": {"confidence": str(raw_item.extraction_confidence)},
            }
        ]


class MissingRequiredFieldsRule(ValidationRule):
    rule_name = "missing_required_fields"

    def evaluate(
        self,
        raw_item: ExtractedItemRaw,
        normalized_item: ExtractedItemNormalized,
        context: ValidationContext,
    ) -> list[dict[str, object]]:
        missing: list[str] = []
        support_row_with_primary_financial_source = (
            raw_item.status != "primary" and _has_complete_primary_sibling(raw_item, context)
        )
        priced_catalog_row = _is_priced_catalog_row(raw_item, normalized_item)
        if not raw_item.raw_description:
            missing.append("description")
        if normalized_item.quantity_num is None and not priced_catalog_row:
            missing.append("quantity")
        if not normalized_item.unit_normalized and not priced_catalog_row:
            missing.append("unit")
        if (
            normalized_item.unit_price_cop is None
            and normalized_item.total_cop is None
            and not support_row_with_primary_financial_source
        ):
            missing.append("price")
        if not missing:
            return []
        return [
            {
                "issue_type": IssueType.MISSING_REQUIRED,
                "severity": Severity.HIGH,
                "title": "Campos requeridos faltantes",
                "message": f"Faltan campos clave para validar o analizar el item: {', '.join(missing)}.",
                "suggested_value": None,
                "evidence_json": {"missing_fields": missing},
            }
        ]


class AmbiguousUnitRule(ValidationRule):
    rule_name = "ambiguous_unit"

    def evaluate(
        self,
        raw_item: ExtractedItemRaw,
        normalized_item: ExtractedItemNormalized,
        context: ValidationContext,
    ) -> list[dict[str, object]]:
        if _is_priced_catalog_row(raw_item, normalized_item):
            return []
        if normalized_item.unit_normalized:
            return []
        return [
            {
                "issue_type": IssueType.AMBIGUOUS_UNIT,
                "severity": Severity.MEDIUM,
                "title": "Unidad ambigua o vacia",
                "message": "El item no tiene una unidad normalizada confiable.",
                "suggested_value": raw_item.raw_unit,
                "evidence_json": {"raw_unit": raw_item.raw_unit},
            }
        ]


class ArithmeticMismatchRule(ValidationRule):
    rule_name = "arithmetic_mismatch"

    def evaluate(
        self,
        raw_item: ExtractedItemRaw,
        normalized_item: ExtractedItemNormalized,
        context: ValidationContext,
    ) -> list[dict[str, object]]:
        qty = normalized_item.quantity_num
        unit_price = normalized_item.unit_price_cop
        total = normalized_item.total_cop
        if qty is None or unit_price is None or total is None:
            return []
        expected_total = qty * unit_price
        tolerance = max(Decimal("100"), total * Decimal("0.02"))
        if abs(expected_total - total) <= tolerance:
            return []
        tax_rate = _parse_tax_rate(raw_item.raw_tax_note)
        if tax_rate is not None:
            expected_with_tax = qty * unit_price * (Decimal("1") + tax_rate)
            if abs(expected_with_tax - total) <= tolerance:
                return []
        return [
            {
                "issue_type": IssueType.ARITHMETIC_MISMATCH,
                "severity": Severity.CRITICAL,
                "title": "Inconsistencia aritmetica",
                "message": "Cantidad por valor unitario no coincide con el total extraido.",
                "suggested_value": str(expected_total),
                "evidence_json": {
                    "quantity": str(qty),
                    "unit_price": str(unit_price),
                    "expected_total": str(expected_total),
                    "reported_total": str(total),
                },
            }
        ]


class DuplicateIdentityRule(ValidationRule):
    rule_name = "duplicate_identity"

    def evaluate(
        self,
        raw_item: ExtractedItemRaw,
        normalized_item: ExtractedItemNormalized,
        context: ValidationContext,
    ) -> list[dict[str, object]]:
        if len(context.siblings) <= 1:
            return []
        same_document = [
            sibling_raw.id
            for sibling_raw, _ in context.siblings
            if sibling_raw.id != raw_item.id
            and sibling_raw.document_id == raw_item.document_id
            and sibling_raw.sheet_name == raw_item.sheet_name
        ]
        if not same_document:
            return []
        return [
            {
                "issue_type": IssueType.DUPLICATE,
                "severity": Severity.MEDIUM,
                "title": "Posible duplicado en la misma fuente",
                "message": "Se detectaron multiples filas con la misma identidad de item dentro del mismo documento.",
                "suggested_value": None,
                "evidence_json": {
                    "duplicate_raw_item_ids": same_document,
                    "canonical_item_key": normalized_item.canonical_item_key,
                },
            }
        ]


class ContradictionRule(ValidationRule):
    rule_name = "contradiction"

    def evaluate(
        self,
        raw_item: ExtractedItemRaw,
        normalized_item: ExtractedItemNormalized,
        context: ValidationContext,
    ) -> list[dict[str, object]]:
        conflicting = []
        for sibling_raw, sibling_normalized in context.siblings:
            if sibling_raw.id == raw_item.id:
                continue
            if sibling_normalized.unit_price_cop is None or normalized_item.unit_price_cop is None:
                continue
            if sibling_normalized.unit_price_cop != normalized_item.unit_price_cop:
                conflicting.append(
                    {
                        "raw_item_id": sibling_raw.id,
                        "document_id": sibling_raw.document_id,
                        "unit_price_cop": str(sibling_normalized.unit_price_cop),
                    }
                )
        if not conflicting:
            return []
        return [
            {
                "issue_type": IssueType.CONTRADICTION,
                "severity": Severity.HIGH,
                "title": "Conflicto entre fuentes para el mismo item",
                "message": "La misma identidad de item aparece con precios distintos en una o mas fuentes.",
                "suggested_value": None,
                "evidence_json": {
                    "canonical_item_key": normalized_item.canonical_item_key,
                    "current_unit_price_cop": str(normalized_item.unit_price_cop),
                    "conflicting_items": conflicting,
                },
            }
        ]


def build_default_rules() -> list[ValidationRule]:
    return [
        LowConfidenceRule(),
        MissingRequiredFieldsRule(),
        AmbiguousUnitRule(),
        ArithmeticMismatchRule(),
        DuplicateIdentityRule(),
        ContradictionRule(),
    ]
