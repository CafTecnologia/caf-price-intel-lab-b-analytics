from __future__ import annotations

from procurement_core.extractors.base import BaseExtractor
from procurement_core.extractors.pdf_native import PDFNativeExtractor
from procurement_core.extractors.pdf_scanned import PDFScannedExtractor
from procurement_core.extractors.excel import ExcelExtractor
from procurement_core.extractors.image_ocr import ImageOCRExtractor
from procurement_core.extractors.pdf import PDFExtractor
from procurement_core.extractors.word import WordExtractor
from procurement_core.models.enums import FileType
from procurement_core.schemas.extraction import DocumentProfile


class ExtractorRegistry:
    def __init__(self) -> None:
        self._extractors: dict[FileType, BaseExtractor] = {
            FileType.PDF: PDFExtractor(),
            FileType.EXCEL: ExcelExtractor(),
            FileType.WORD: WordExtractor(),
            FileType.IMAGE: ImageOCRExtractor(),
        }
        self._profile_extractors: list[BaseExtractor] = [
            PDFNativeExtractor(),
            PDFScannedExtractor(),
            ExcelExtractor(),
            WordExtractor(),
            ImageOCRExtractor(),
        ]

    def get_for_type(self, file_type: FileType) -> BaseExtractor | None:
        return self._extractors.get(file_type)

    def get_for_profile(self, profile: DocumentProfile) -> BaseExtractor | None:
        for extractor in self._profile_extractors:
            if extractor.supports(profile):
                return extractor
        return self.get_for_type(profile.file_type)
