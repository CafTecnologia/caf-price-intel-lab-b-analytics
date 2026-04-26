from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from pydantic import Field

from procurement_core.models.enums import DocumentKind, ExtractionMethod, FileType
from procurement_core.schemas.common import JsonDict, ProcurementBaseModel


class FileIngested(ProcurementBaseModel):
    file_name: str
    file_hash: str
    file_type: FileType
    mime_type: str | None = None
    storage_path: Path
    metadata: JsonDict = Field(default_factory=dict)


class DocumentProfile(ProcurementBaseModel):
    file_name: str
    file_type: FileType
    mime_type: str | None = None
    is_pdf_native: bool | None = None
    requires_ocr: bool = False
    route: str
    detected_by: str = "extension"
    metadata: JsonDict = Field(default_factory=dict)


class DocumentClassification(ProcurementBaseModel):
    document_kind: DocumentKind = DocumentKind.UNKNOWN
    confidence: Decimal = Decimal("0.00")
    method: str = "rules"
    requires_llm_review: bool = False
    matched_keywords: list[str] = Field(default_factory=list)
    metadata: JsonDict = Field(default_factory=dict)


class PageExtraction(ProcurementBaseModel):
    page_number: int | None = None
    sheet_name: str | None = None
    extracted_text: str | None = None
    bbox: JsonDict | None = None
    metadata: JsonDict = Field(default_factory=dict)


class RawItemCandidate(ProcurementBaseModel):
    raw_item_number: str | None = None
    lot: str | None = None
    section: str | None = None
    page_number: int | None = None
    sheet_name: str | None = None
    bbox: JsonDict | None = None
    row_index: int | None = None
    cell_range: str | None = None
    raw_description: str
    raw_quantity: str | None = None
    raw_unit: str | None = None
    raw_unit_price: str | None = None
    raw_total: str | None = None
    raw_currency: str | None = None
    raw_tax_note: str | None = None
    extraction_method: ExtractionMethod
    extraction_confidence: Decimal | None = None
    preview_evidence_path: str | None = None
    evidence: JsonDict = Field(default_factory=dict)


class ExtractionBatch(ProcurementBaseModel):
    document_kind: DocumentKind = DocumentKind.UNKNOWN
    pages: list[PageExtraction] = Field(default_factory=list)
    items: list[RawItemCandidate] = Field(default_factory=list)
    metadata: JsonDict = Field(default_factory=dict)
