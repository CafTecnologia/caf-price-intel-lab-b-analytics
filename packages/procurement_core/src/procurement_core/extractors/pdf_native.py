from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader

from procurement_core.extractors.base import BaseExtractor
from procurement_core.extractors.helpers import map_headers, row_to_candidate, text_lines_to_candidates
from procurement_core.extractors.table_extractors import TableExtractionRouter
from procurement_core.models.enums import ExtractionMethod, FileType
from procurement_core.schemas.extraction import DocumentProfile, ExtractionBatch, PageExtraction
from procurement_core.services.document_classifier import RuleBasedDocumentClassifier


class PDFNativeExtractor(BaseExtractor):
    file_type = FileType.PDF
    route_name = "pdf_native"

    def __init__(self, table_router: TableExtractionRouter | None = None) -> None:
        self.table_router = table_router or TableExtractionRouter()
        self.classifier = RuleBasedDocumentClassifier()

    def supports(self, profile: DocumentProfile) -> bool:
        return profile.file_type == FileType.PDF and profile.route == self.route_name

    def extract(self, file_path: Path, profile: DocumentProfile | None = None) -> ExtractionBatch:
        reader = PdfReader(str(file_path))
        combined_text_parts: list[str] = []
        pages: list[PageExtraction] = []
        items = []

        for index, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            combined_text_parts.append(text)
            pages.append(PageExtraction(page_number=index, extracted_text=text, metadata={"source": "pypdf"}))
            items.extend(text_lines_to_candidates(text, page_number=index))

        tables, table_method = self.table_router.extract(file_path)
        previous_header_map: dict[str, int] | None = None
        for table in tables:
            if not table or len(table) < 2:
                continue
            header_map = map_headers(table[0])
            data_rows = table[1:]
            if "description" not in header_map:
                if previous_header_map is None:
                    continue
                continued_candidate = row_to_candidate(
                    list(table[0]),
                    previous_header_map,
                    row_index=1,
                    method=ExtractionMethod.PDF_TABLE,
                )
                if continued_candidate is None:
                    continue
                header_map = previous_header_map
                data_rows = table
            else:
                previous_header_map = header_map
            for row_index, row in enumerate(data_rows, start=2):
                candidate = row_to_candidate(
                    list(row),
                    header_map,
                    row_index=row_index,
                    method=ExtractionMethod.PDF_TABLE,
                )
                if candidate:
                    candidate.evidence["table_extractor"] = table_method
                    items.append(candidate)

        full_text = "\n".join(combined_text_parts)
        classification = self.classifier.classify(file_path.name, full_text)
        return ExtractionBatch(
            document_kind=classification.document_kind,
            pages=pages,
            items=items,
            metadata={
                "page_count": len(pages),
                "route": self.route_name,
                "table_method": table_method,
                "classification": classification.model_dump(mode="json"),
            },
        )
