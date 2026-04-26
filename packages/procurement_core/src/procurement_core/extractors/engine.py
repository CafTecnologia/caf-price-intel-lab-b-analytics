from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader

from procurement_core.extractors.factory import ExtractorRegistry
from procurement_core.models.orm import ProcessDocument
from procurement_core.schemas.extraction import DocumentProfile, ExtractionBatch
from procurement_core.services.document_classifier import RuleBasedDocumentClassifier


class LocalExtractionEngine:
    def __init__(self, registry: ExtractorRegistry | None = None) -> None:
        self.registry = registry or ExtractorRegistry()
        self.classifier = RuleBasedDocumentClassifier()

    def build_profile(self, document: ProcessDocument) -> DocumentProfile:
        route = document.file_type.value
        is_pdf_native = None
        requires_ocr = False
        metadata: dict[str, object] = {}
        document_metadata = document.metadata_json or {}

        if document.file_type.value == "pdf":
            is_pdf_native = self._is_pdf_native(Path(document.storage_path))
            route = "pdf_native" if is_pdf_native else "pdf_scanned"
            requires_ocr = not bool(is_pdf_native)
            metadata["pdf_detection"] = "text-layer" if is_pdf_native else "image-like"

        route_override = document_metadata.get("extraction_route_override")
        if isinstance(route_override, str) and route_override.strip():
            route = route_override.strip()
            if route == "pdf_scanned":
                requires_ocr = True
                is_pdf_native = False
            elif route == "pdf_native":
                requires_ocr = False
                is_pdf_native = True
            metadata["route_override_applied"] = route

        extraction_mode = document_metadata.get("extraction_mode")
        if extraction_mode:
            metadata["extraction_mode"] = extraction_mode

        return DocumentProfile(
            file_name=document.file_name,
            file_type=document.file_type,
            mime_type=document.mime_type,
            is_pdf_native=is_pdf_native,
            requires_ocr=requires_ocr,
            route=route,
            detected_by="content" if is_pdf_native is not None else "extension",
            metadata=metadata,
        )

    def extract_document(self, document: ProcessDocument) -> tuple[DocumentProfile, ExtractionBatch]:
        profile = self.build_profile(document)
        extractor = self.registry.get_for_profile(profile)
        if extractor is None:
            raise ValueError(f"No extractor available for route {profile.route}")
        batch = extractor.extract(Path(document.storage_path), profile=profile)
        text = "\n".join(filter(None, [page.extracted_text for page in batch.pages]))
        classification = self.classifier.classify(document.file_name, text)
        if batch.document_kind.value == "unknown":
            batch.document_kind = classification.document_kind
        batch.metadata = dict(batch.metadata or {})
        batch.metadata["profile"] = profile.model_dump(mode="json")
        batch.metadata["classification"] = classification.model_dump(mode="json")
        return profile, batch

    def _is_pdf_native(self, file_path: Path) -> bool:
        try:
            reader = PdfReader(str(file_path))
        except Exception:
            return False
        text_length = 0
        for page in reader.pages[:3]:
            text_length += len((page.extract_text() or "").strip())
        return text_length >= 80
