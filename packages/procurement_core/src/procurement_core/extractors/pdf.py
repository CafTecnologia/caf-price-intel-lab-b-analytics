from __future__ import annotations

from pathlib import Path

from procurement_core.extractors.base import BaseExtractor
from procurement_core.extractors.pdf_native import PDFNativeExtractor
from procurement_core.extractors.pdf_scanned import PDFScannedExtractor
from procurement_core.models.enums import FileType
from procurement_core.schemas.extraction import DocumentProfile, ExtractionBatch


class PDFExtractor(BaseExtractor):
    file_type = FileType.PDF
    route_name = "pdf_router"

    def __init__(self) -> None:
        self.native = PDFNativeExtractor()
        self.scanned = PDFScannedExtractor()

    def extract(self, file_path: Path, profile: DocumentProfile | None = None) -> ExtractionBatch:
        if profile and profile.route == "pdf_scanned":
            return self.scanned.extract(file_path, profile=profile)
        return self.native.extract(file_path, profile=profile)
