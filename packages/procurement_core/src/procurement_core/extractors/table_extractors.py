from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

import pdfplumber

try:
    import camelot
except Exception:  # pragma: no cover
    camelot = None


class TableExtractor(ABC):
    extractor_name: str

    @abstractmethod
    def is_available(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def extract_tables(self, file_path: Path) -> list[list[list[str | None]]]:
        raise NotImplementedError


class CamelotTableExtractor(TableExtractor):
    extractor_name = "camelot"

    def is_available(self) -> bool:
        return camelot is not None

    def extract_tables(self, file_path: Path) -> list[list[list[str | None]]]:
        if not self.is_available():
            return []
        try:
            tables = camelot.read_pdf(str(file_path), pages="all", flavor="stream")
        except Exception:  # pragma: no cover
            return []
        extracted: list[list[list[str | None]]] = []
        for table in tables:
            dataframe = table.df.fillna("")
            extracted.append(dataframe.values.tolist())
        return extracted


class PdfPlumberTableExtractor(TableExtractor):
    extractor_name = "pdfplumber"

    def is_available(self) -> bool:
        return True

    def extract_tables(self, file_path: Path) -> list[list[list[str | None]]]:
        extracted: list[list[list[str | None]]] = []
        with pdfplumber.open(str(file_path)) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables():
                    if table:
                        extracted.append(table)
        return extracted


class TableExtractionRouter:
    def __init__(self, extractors: list[TableExtractor] | None = None) -> None:
        self.extractors = extractors or [CamelotTableExtractor(), PdfPlumberTableExtractor()]

    def extract(self, file_path: Path) -> tuple[list[list[list[str | None]]], str]:
        for extractor in self.extractors:
            if not extractor.is_available():
                continue
            tables = extractor.extract_tables(file_path)
            if tables:
                return tables, extractor.extractor_name
        return [], "none"
