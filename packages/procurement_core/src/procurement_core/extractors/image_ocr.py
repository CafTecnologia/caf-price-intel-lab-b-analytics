from __future__ import annotations

from pathlib import Path

from procurement_core.extractors.base import BaseExtractor
from procurement_core.extractors.ocr import LocalOCRChain
from procurement_core.extractors.helpers import text_lines_to_candidates
from procurement_core.models.enums import DocumentKind, FileType
from procurement_core.schemas.extraction import DocumentProfile, ExtractionBatch, PageExtraction


class ImageOCRExtractor(BaseExtractor):
    file_type = FileType.IMAGE
    route_name = "image"

    def __init__(self, ocr_chain: LocalOCRChain | None = None) -> None:
        self.ocr_chain = ocr_chain or LocalOCRChain()

    def extract(self, file_path: Path, profile: DocumentProfile | None = None) -> ExtractionBatch:
        result = self.ocr_chain.run(file_path)
        text = result.extracted_text or ""
        items = text_lines_to_candidates(text, page_number=1)
        return ExtractionBatch(
            document_kind=DocumentKind.UNKNOWN,
            pages=[
                PageExtraction(
                    page_number=1,
                    extracted_text=text or None,
                    metadata={
                        "source": result.provider_name,
                        **(result.metadata or {}),
                    },
                )
            ],
            items=items,
            metadata={"ocr_available": result.succeeded, "route": self.route_name},
        )
