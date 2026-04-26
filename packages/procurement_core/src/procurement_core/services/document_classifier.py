from __future__ import annotations

import re
import unicodedata
from decimal import Decimal

from procurement_core.models.enums import DocumentKind
from procurement_core.schemas.extraction import DocumentClassification


KEYWORDS = {
    DocumentKind.INVITATION: ["invitacion publica", "pliego", "terminos de referencia"],
    DocumentKind.PRIOR_STUDY: ["estudio previo"],
    DocumentKind.MARKET_STUDY: ["estudio del sector", "estudio de mercado"],
    DocumentKind.OFFICIAL_BUDGET: ["presupuesto oficial", "cuadro de presupuesto", "precio techo"],
    DocumentKind.TECHNICAL_ANNEX: ["ficha tecnica", "anexo tecnico", "especificaciones tecnicas"],
    DocumentKind.PRICE_LIST: ["lista de precios", "precio unitario", "valor unitario", "precio techo unitario"],
    DocumentKind.ECONOMIC_ANNEX: ["anexo economico", "oferta economica"],
}


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.lower()).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", normalized)


class RuleBasedDocumentClassifier:
    def classify(self, file_name: str, text: str) -> DocumentClassification:
        haystack = _normalize_text(f"{file_name}\n{text}")
        scores: dict[DocumentKind, int] = {}
        matches: dict[DocumentKind, list[str]] = {}

        for kind, aliases in KEYWORDS.items():
            matched = [alias for alias in aliases if alias in haystack]
            if matched:
                scores[kind] = len(matched)
                matches[kind] = matched

        if not scores:
            return DocumentClassification(
                document_kind=DocumentKind.UNKNOWN,
                confidence=Decimal("0.20"),
                method="rules",
                requires_llm_review=True,
                matched_keywords=[],
            )

        ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        top_kind, top_score = ordered[0]
        second_score = ordered[1][1] if len(ordered) > 1 else 0
        confidence = Decimal("0.55") + Decimal(min(top_score, 3)) * Decimal("0.12")
        requires_llm_review = top_score == second_score or confidence < Decimal("0.75")

        return DocumentClassification(
            document_kind=top_kind,
            confidence=min(confidence, Decimal("0.95")),
            method="rules",
            requires_llm_review=requires_llm_review,
            matched_keywords=matches.get(top_kind, []),
            metadata={"score_gap": top_score - second_score},
        )
