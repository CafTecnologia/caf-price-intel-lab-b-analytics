from __future__ import annotations

from pathlib import Path

from procurement_core.extractors.base import BaseExtractor
from procurement_core.extractors.helpers import text_lines_to_candidates
from procurement_core.extractors.ocr import LocalOCRChain, OCRResult, OCRmyPDFProvider
from procurement_core.models.enums import DocumentKind, FileType
from procurement_core.schemas.extraction import DocumentProfile, ExtractionBatch, PageExtraction


class PDFScannedExtractor(BaseExtractor):
    file_type = FileType.PDF
    route_name = "pdf_scanned"

    def __init__(self, ocr_chain: LocalOCRChain | None = None, pdf_provider: OCRmyPDFProvider | None = None) -> None:
        self.ocr_chain = ocr_chain or LocalOCRChain()
        self.pdf_provider = pdf_provider or OCRmyPDFProvider()

    def supports(self, profile: DocumentProfile) -> bool:
        return profile.file_type == FileType.PDF and profile.route == self.route_name

    def extract(self, file_path: Path, profile: DocumentProfile | None = None) -> ExtractionBatch:
        ocr_result: OCRResult
        if self.pdf_provider.is_available():
            ocr_result = self.pdf_provider.run(file_path)
        else:
            ocr_result = OCRResult(
                provider_name="none",
                succeeded=False,
                metadata={"warning": "ocrmypdf unavailable for scanned pdf"},
            )

        text = ocr_result.extracted_text or ""
        items = text_lines_to_candidates(text, page_number=1)
        pages = [
            PageExtraction(
                page_number=1,
                extracted_text=text or None,
                metadata={
                    "route": self.route_name,
                    "ocr_provider": ocr_result.provider_name,
                    "ocr_succeeded": ocr_result.succeeded,
                    **(ocr_result.metadata or {}),
                },
            )
        ]
        if not ocr_result.succeeded:
            fallback = self.ocr_chain.run(file_path)
            if fallback.extracted_text:
                pages[0].extracted_text = fallback.extracted_text
                pages[0].metadata["fallback_provider"] = fallback.provider_name
                pages[0].metadata["fallback_attempts"] = fallback.metadata.get("attempts", [])
                items = text_lines_to_candidates(fallback.extracted_text, page_number=1)

        return ExtractionBatch(
            document_kind=DocumentKind.UNKNOWN,
            pages=pages,
            items=items,
            metadata={"route": self.route_name, "requires_review": not bool(items)},
        )
