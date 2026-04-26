from __future__ import annotations

from decimal import Decimal

from procurement_core.models.enums import AssessmentClassification


def classify_financial_gap(gap_pct: Decimal | None) -> AssessmentClassification:
    if gap_pct is None:
        return AssessmentClassification.UNKNOWN
    if gap_pct >= Decimal("0.18"):
        return AssessmentClassification.VIABLE
    if gap_pct >= Decimal("0.08"):
        return AssessmentClassification.TIGHT
    if gap_pct >= Decimal("0"):
        return AssessmentClassification.RISKY
    return AssessmentClassification.UNVIABLE


def build_explanation(classification: AssessmentClassification, gap_pct: Decimal | None) -> str:
    if classification == AssessmentClassification.UNKNOWN:
        return "No hay benchmark suficiente para clasificar con confianza."
    pct = f"{(gap_pct or Decimal('0')) * Decimal('100'):.2f}%"
    return {
        AssessmentClassification.VIABLE: f"El precio de referencia se ubica con holgura frente al benchmark estimado. Gap: {pct}.",
        AssessmentClassification.TIGHT: f"El margen estimado existe, pero es estrecho frente al benchmark. Gap: {pct}.",
        AssessmentClassification.RISKY: f"El gap frente al benchmark es marginal y la oferta requeriría revisión fina. Gap: {pct}.",
        AssessmentClassification.UNVIABLE: f"El precio de referencia está por debajo del benchmark estimado. Gap: {pct}.",
    }[classification]
