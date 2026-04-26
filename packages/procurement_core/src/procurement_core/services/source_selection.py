from __future__ import annotations

from procurement_core.models.enums import FileType
from procurement_core.models.orm import ExtractedItemNormalized


FILE_TYPE_PRIORITY = {
    FileType.EXCEL: 400,
    FileType.PDF: 300,
    FileType.WORD: 250,
    FileType.IMAGE: 150,
    FileType.OTHER: 100,
}


def normalized_item_source_score(item: ExtractedItemNormalized) -> int:
    raw_item = item.raw_item
    document = raw_item.document
    score = FILE_TYPE_PRIORITY.get(document.file_type, 0)
    item_number = (item.metadata_json or {}).get("item_number_normalized")
    document_metadata = document.metadata_json or {}
    evidence = raw_item.evidence_json or {}

    if item.normalized_description:
        score += 120
    if item_number:
        score += 220
    if item.quantity_num is not None:
        score += 80
    if item.unit_normalized:
        score += 40
    if item.unit_price_cop is not None:
        score += 200
    if item.total_cop is not None:
        score += 180
    if raw_item.extraction_confidence is not None:
        score += int(float(raw_item.extraction_confidence) * 100)
    if document_metadata.get("stage1_support_only"):
        score -= 500
    if evidence.get("sheet_role") == "support":
        score -= 700
    if evidence.get("row_role") == "support_item":
        score -= 180
    if evidence.get("row_role") == "note":
        score -= 260
    priority_override = document_metadata.get("stage1_priority_override")
    if isinstance(priority_override, (int, float)):
        score += int(priority_override)

    return score


def is_complete_financial_source(item: ExtractedItemNormalized) -> bool:
    return (
        item.normalized_description is not None
        and item.quantity_num is not None
        and item.unit_normalized is not None
        and item.unit_price_cop is not None
        and item.total_cop is not None
    )
