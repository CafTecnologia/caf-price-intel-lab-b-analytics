from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from procurement_core.models.enums import FileType
from procurement_core.schemas.extraction import DocumentProfile, ExtractionBatch


class BaseExtractor(ABC):
    file_type: FileType
    route_name: str | None = None

    def supports(self, profile: DocumentProfile) -> bool:
        return profile.file_type == self.file_type

    @abstractmethod
    def extract(self, file_path: Path, profile: DocumentProfile | None = None) -> ExtractionBatch:
        raise NotImplementedError
