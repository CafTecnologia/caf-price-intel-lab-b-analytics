from __future__ import annotations

from procurement_core.models.enums import DocumentKind
from procurement_core.services.document_classifier import RuleBasedDocumentClassifier


def classify_document_from_text(file_name: str, text: str) -> DocumentKind:
    return RuleBasedDocumentClassifier().classify(file_name, text).document_kind
