from __future__ import annotations

from decimal import Decimal, InvalidOperation

from procurement_core.models.orm import (
    BenchmarkItem,
    ExtractedItemRaw,
    FinancialAssessment,
    ProcessDocument,
    ProcurementProcess,
    ValidationIssue,
)
from procurement_core.schemas.process import (
    AnalysisTraceEntryRead,
    BenchmarkSourceDetailRead,
    ConsolidatedItemRead,
    DocumentRead,
    FinancialAssessmentDetailRead,
    NormalizedItemRead,
    ProcessDetail,
    ProcessRead,
    RawItemRead,
    Stage1AutoFixSnapshotRead,
    StageSummaryRead,
    ValidationIssueRead,
)


def _item_number(raw_item: ExtractedItemRaw) -> str | None:
    value = (raw_item.evidence_json or {}).get("item_number")
    if value is None:
        normalized = raw_item.normalized_item
        if normalized is not None:
            value = (normalized.metadata_json or {}).get("item_number")
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _origin_label(raw_item: ExtractedItemRaw) -> str:
    slot = raw_item.sheet_name or (
        f"Pag. {raw_item.page_number}" if raw_item.page_number is not None else "Origen no especificado"
    )
    return f"{raw_item.file_name} | {slot}"


def _safe_decimal(text: str | None) -> tuple[int, str]:
    if not text:
        return (1_000_000, "")
    try:
        value = Decimal(text)
        return (0, f"{value:020.4f}")
    except (InvalidOperation, ValueError):
        return (500_000, text)


def _consolidated_sort_key(item: ConsolidatedItemRead) -> tuple[int, str, str]:
    item_number = item.item_number or ""
    decimal_rank, decimal_value = _safe_decimal(item_number)
    return (decimal_rank, decimal_value or item_number.lower(), item.raw_description.lower())


def build_raw_item_read(raw_item: ExtractedItemRaw) -> RawItemRead:
    return RawItemRead(
        id=raw_item.id,
        created_at=raw_item.created_at,
        updated_at=raw_item.updated_at,
        process_id=raw_item.process_id,
        document_id=raw_item.document_id,
        file_name=raw_item.file_name,
        file_hash=raw_item.file_hash,
        item_number=_item_number(raw_item),
        lot=raw_item.lot,
        section=raw_item.section,
        page_number=raw_item.page_number,
        sheet_name=raw_item.sheet_name,
        raw_description=raw_item.raw_description,
        raw_quantity=raw_item.raw_quantity,
        raw_unit=raw_item.raw_unit,
        raw_unit_price=raw_item.raw_unit_price,
        raw_total=raw_item.raw_total,
        extraction_method=str(raw_item.extraction_method),
        extraction_confidence=raw_item.extraction_confidence,
        status=raw_item.status,
        origin=_origin_label(raw_item),
    )


def build_consolidated_item_read(raw_item: ExtractedItemRaw) -> ConsolidatedItemRead:
    normalized = raw_item.normalized_item
    metadata = normalized.metadata_json if normalized is not None else {}
    return ConsolidatedItemRead(
        raw_item_id=raw_item.id,
        normalized_item_id=normalized.id if normalized is not None else None,
        item_number=_item_number(raw_item),
        raw_description=raw_item.raw_description,
        raw_quantity=raw_item.raw_quantity,
        raw_unit=raw_item.raw_unit,
        raw_unit_price=raw_item.raw_unit_price,
        raw_total=raw_item.raw_total,
        origin=_origin_label(raw_item),
        file_name=raw_item.file_name,
        source_count=int(metadata.get("duplicate_cluster_size", 1) or 1),
        canonical_item_key=normalized.canonical_item_key if normalized is not None else None,
        lot=raw_item.lot,
    )


def build_benchmark_source_read(item: BenchmarkItem) -> BenchmarkSourceDetailRead:
    return BenchmarkSourceDetailRead(
        source_name=item.source.source_name,
        source_url=item.source_url,
        country=item.source_country or item.source.country,
        currency=item.currency,
        original_price=item.original_price,
        normalized_price_cop=item.normalized_price_cop,
        commercial_presentation=item.commercial_presentation,
        condition=item.condition,
        comparability=item.comparability.value if item.comparability else None,
        comparability_score=item.comparability_score,
        observations=item.observations,
        evidence_json=item.evidence_json or {},
    )


def build_assessment_read(assessment: FinancialAssessment) -> FinancialAssessmentDetailRead:
    normalized = assessment.normalized_item
    raw_item = normalized.raw_item if normalized is not None else None
    benchmark_items = sorted(
        list(normalized.benchmark_items if normalized is not None else []),
        key=lambda item: (
            -(float(item.comparability_score) if item.comparability_score is not None else 0.0),
            -(float(item.normalized_price_cop) if item.normalized_price_cop is not None else 0.0),
        ),
    )
    return FinancialAssessmentDetailRead(
        id=assessment.id,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        normalized_item_id=assessment.normalized_item_id,
        price_ref_entity_unit=assessment.price_ref_entity_unit,
        price_ref_entity_total=assessment.price_ref_entity_total,
        benchmark_median=assessment.benchmark_median,
        gap_cop=assessment.gap_cop,
        gap_pct=assessment.gap_pct,
        estimated_gross_margin=assessment.estimated_gross_margin,
        classification=assessment.classification,
        explanation=assessment.explanation,
        item_number=_item_number(raw_item) if raw_item is not None else None,
        raw_item_id=raw_item.id if raw_item is not None else None,
        raw_description=raw_item.raw_description if raw_item is not None else None,
        raw_quantity=raw_item.raw_quantity if raw_item is not None else None,
        raw_unit=raw_item.raw_unit if raw_item is not None else None,
        raw_unit_price=raw_item.raw_unit_price if raw_item is not None else None,
        raw_total=raw_item.raw_total if raw_item is not None else None,
        origin=_origin_label(raw_item) if raw_item is not None else None,
        benchmark_min=assessment.benchmark_min,
        benchmark_p25=assessment.benchmark_p25,
        benchmark_p75=assessment.benchmark_p75,
        benchmark_dispersion=assessment.benchmark_dispersion,
        benchmark_points=len(benchmark_items),
        benchmark_sources=[build_benchmark_source_read(item) for item in benchmark_items],
    )


def build_process_detail(
    process: ProcurementProcess,
    documents: list[ProcessDocument],
    issues: list[ValidationIssue],
) -> ProcessDetail:
    has_primary = any(raw_item.status == "primary" for raw_item in process.raw_items)
    raw_items = sorted(
        [build_raw_item_read(raw_item) for raw_item in process.raw_items],
        key=lambda item: (item.file_name.lower(), item.item_number or "", item.raw_description.lower()),
    )
    consolidated = [
        build_consolidated_item_read(raw_item)
        for raw_item in process.raw_items
        if (raw_item.status == "primary" or not has_primary)
        and (
            raw_item.normalized_item is None
            or (raw_item.normalized_item.metadata_json or {}).get("summary_include", True)
        )
    ]
    consolidated = sorted(consolidated, key=_consolidated_sort_key)
    assessments: list[FinancialAssessment] = [
        raw_item.normalized_item.financial_assessment
        for raw_item in process.raw_items
        if raw_item.normalized_item and raw_item.normalized_item.financial_assessment
    ]
    normalized_items = [
        NormalizedItemRead.model_validate(raw_item.normalized_item)
        for raw_item in process.raw_items
        if raw_item.normalized_item is not None
    ]
    analysis_trace = [
        AnalysisTraceEntryRead.model_validate(entry)
        for entry in (process.metadata_json or {}).get("analysis_trace", [])
    ]
    stage_summaries = _build_stage_summaries(
        process,
        documents,
        raw_items,
        normalized_items,
        issues,
        assessments,
        analysis_trace,
    )
    stage1_last_auto_fix_data = (process.metadata_json or {}).get("stage1_last_auto_fix")
    return ProcessDetail(
        process=ProcessRead.model_validate(process),
        documents=[DocumentRead.model_validate(document) for document in documents],
        consolidated_items=consolidated,
        raw_items=raw_items,
        normalized_items=normalized_items,
        issues=[ValidationIssueRead.model_validate(issue) for issue in issues],
        assessments=[build_assessment_read(item) for item in assessments],
        analysis_trace=analysis_trace,
        stage_summaries=stage_summaries,
        stage1_last_auto_fix=(
            Stage1AutoFixSnapshotRead.model_validate(stage1_last_auto_fix_data)
            if isinstance(stage1_last_auto_fix_data, dict)
            else None
        ),
    )


def _trace_output_map(analysis_trace: list[AnalysisTraceEntryRead]) -> dict[str, dict]:
    return {entry.stage_code: entry.outputs for entry in analysis_trace}


def _clamp_score(value: int) -> int:
    return max(0, min(100, value))


def _stage_1_missing_financial_limit(usable_rows: int) -> int:
    if usable_rows <= 3:
        return 1
    return max(2, usable_rows // 10)


def _has_stage_1_financial_basis(item: RawItemRead) -> bool:
    normalized = item.normalized_item
    has_quantity = bool(item.raw_quantity) or (normalized is not None and normalized.quantity_num is not None)
    has_unit = bool(item.raw_unit) or (normalized is not None and normalized.unit_normalized is not None)
    has_unit_price = bool(item.raw_unit_price) or (normalized is not None and normalized.unit_price_cop is not None)
    has_total = bool(item.raw_total) or (normalized is not None and normalized.total_cop is not None)
    has_item_number = bool((item.evidence_json or {}).get("item_number")) or bool(
        (normalized.metadata_json or {}).get("item_number") if normalized is not None else None
    )
    priced_catalog_basis = has_item_number and bool(item.raw_description) and has_unit_price and has_quantity
    if priced_catalog_basis:
        return True
    return has_quantity and has_unit and has_unit_price and has_total


def _stage_1_consistency_score(
    *,
    documents_count: int,
    raw_items_count: int,
    low_confidence: int,
    missing_financial_fields: int,
    missing_item_number: int,
    suspicious_noise: int,
    review_excluded: int,
    has_excel_source: bool,
    excel_primary_count: int,
) -> int:
    score = 100
    minimum_expected_rows = 1 if documents_count <= 2 else min(3, documents_count)
    if raw_items_count == 0:
        score -= 70
    elif raw_items_count < minimum_expected_rows:
        score -= 24
    score -= min(30, low_confidence * 12)
    score -= min(34, missing_financial_fields * 7)
    score -= min(24, missing_item_number * 8)
    score -= min(36, suspicious_noise * 18)
    score -= min(35, review_excluded * 25)
    if has_excel_source and excel_primary_count == 0:
        score -= 20
    return _clamp_score(score)


def _build_stage_summaries(
    process: ProcurementProcess,
    documents: list[ProcessDocument],
    raw_items: list[RawItemRead],
    normalized_items: list[NormalizedItemRead],
    issues: list[ValidationIssue],
    assessments: list[FinancialAssessment],
    analysis_trace: list[AnalysisTraceEntryRead],
) -> list[StageSummaryRead]:
    outputs = _trace_output_map(analysis_trace)
    process_raw_items = list(process.raw_items)
    has_primary_sources = any(raw_item.status == "primary" for raw_item in process_raw_items)
    primary_raw_items = [
        raw_item
        for raw_item in process_raw_items
        if raw_item.status == "primary" or not has_primary_sources
    ]
    corroborative_raw_items = [
        raw_item
        for raw_item in process_raw_items
        if raw_item not in primary_raw_items
    ]
    primary_visible_items = [
        raw_item
        for raw_item in primary_raw_items
        if raw_item.normalized_item is None
        or (raw_item.normalized_item.metadata_json or {}).get("summary_include", True)
    ]
    excel_documents = [
        document
        for document in documents
        if str(document.file_name).lower().endswith((".xlsx", ".xlsm", ".xls"))
    ]
    excel_primary_count = len(
        [
            item
            for item in primary_raw_items
            if item.file_name.lower().endswith((".xlsx", ".xlsm", ".xls"))
        ]
    )
    low_confidence = len(
        [
            item
            for item in primary_visible_items
            if item.extraction_confidence is not None and Decimal(str(item.extraction_confidence)) < Decimal("0.65")
        ]
    )
    missing_financial_fields = len(
        [
            item
            for item in primary_visible_items
            if not _has_stage_1_financial_basis(item)
        ]
    )
    support_missing_financial_fields = len(
        [
            item
            for item in corroborative_raw_items
            if not _has_stage_1_financial_basis(item)
        ]
    )
    missing_item_number = len(
        [
            item
            for item in primary_visible_items
            if not (
                (item.evidence_json or {}).get("item_number")
                or ((item.normalized_item.metadata_json or {}) if item.normalized_item is not None else {}).get("item_number")
            )
        ]
    )
    suspicious_noise = len(
        [
            item
            for item in primary_visible_items
            if item.raw_description
            and (
                item.raw_description == (item.raw_unit or "")
                or item.raw_description == (item.raw_total or "")
                or (
                    not (
                        (item.evidence_json or {}).get("item_number")
                        or ((item.normalized_item.metadata_json or {}) if item.normalized_item is not None else {}).get("item_number")
                    )
                    and not item.raw_quantity
                    and not item.raw_unit_price
                )
            )
        ]
    )
    review_excluded = len(primary_raw_items) - len(primary_visible_items)
    redundant_gate = (process.metadata_json or {}).get("stage1_redundant_verdict")
    if not isinstance(redundant_gate, dict):
        redundant_gate = {}
    effective_stage1_rows = len(primary_visible_items)
    minimum_expected_rows = 1 if len(documents) <= 2 else min(3, len(documents))
    missing_financial_limit = _stage_1_missing_financial_limit(effective_stage1_rows)
    stage_1_needs_review = (
        effective_stage1_rows == 0
        or effective_stage1_rows < minimum_expected_rows
        or low_confidence > 0
        or suspicious_noise > 0
        or missing_financial_fields >= missing_financial_limit
        or review_excluded > 0
        or redundant_gate.get("final_decision") == "review_required"
    )
    stage_1_blockers: list[str] = []
    if len(process_raw_items) == 0:
        stage_1_blockers.append("No se extrajeron filas RAW del proceso.")
    if effective_stage1_rows == 0:
        stage_1_blockers.append("No quedaron filas primarias utilizables despues de consolidar la etapa 1.")
    elif effective_stage1_rows < minimum_expected_rows:
        stage_1_blockers.append("La extraccion primaria produjo muy pocas filas utilizables para la cantidad de documentos cargados.")
    if low_confidence > 0:
        stage_1_blockers.append("Hay filas con confidence de extraccion bajo.")
    if missing_financial_fields >= missing_financial_limit:
        stage_1_blockers.append("Faltan campos financieros criticos en demasiadas filas primarias.")
    if missing_item_number > 0:
        stage_1_blockers.append("Hay filas primarias sin numero de item identificable.")
    if suspicious_noise > 0:
        stage_1_blockers.append("Se detectaron filas primarias que parecen ruido o texto narrativo.")
    if review_excluded > 0:
        stage_1_blockers.append("La revision de calidad excluyo una o mas filas primarias del resumen oficial.")
    if excel_documents and excel_primary_count == 0:
        stage_1_blockers.append("Existe Excel cargado, pero no quedo como fuente primaria util en etapa 1.")
    for extra_reason in redundant_gate.get("reasons", []):
        text = str(extra_reason).strip()
        if text and text not in stage_1_blockers:
            stage_1_blockers.append(text)
    stage_1_score = _stage_1_consistency_score(
        documents_count=len(documents),
        raw_items_count=effective_stage1_rows,
        low_confidence=low_confidence,
        missing_financial_fields=missing_financial_fields,
        missing_item_number=missing_item_number,
        suspicious_noise=suspicious_noise,
        review_excluded=review_excluded,
        has_excel_source=bool(excel_documents),
        excel_primary_count=excel_primary_count,
    )

    validation_issues = len(issues)
    stage_2_needs_review = validation_issues > 0 or review_excluded > 0
    benchmark_points = int(outputs.get("benchmark_financial", {}).get("benchmark_points", 0) or 0)
    financial_assessments = len(assessments)
    stage_3_needs_review = financial_assessments == 0 or benchmark_points == 0
    consolidated_primary_count = len(primary_visible_items)

    return [
        StageSummaryRead(
            stage_code="stage_1_extraction_normalization",
            title="Etapa 1 · Extracción y normalización",
            status="review_required" if stage_1_needs_review else "ready",
            consistency_score=stage_1_score,
            automation_ready=stage_1_score >= 75 and not stage_1_needs_review,
            description=(
                "Aquí se decide si la lectura base del proceso es confiable. "
                "Si esta etapa sale mal, no conviene confiar en los benchmarks posteriores."
            ),
            recommended_action=(
                "Revisa la matriz RAW, la tabla normalizada y los documentos por ruta de extracción. "
                "Si ves ruido, corrige aquí o pídele apoyo a la IA antes de seguir."
            ),
            blocking_reasons=stage_1_blockers,
            metrics={
                "documents": len(documents),
                "raw_items": len(raw_items),
                "primary_rows": len(primary_raw_items),
                "primary_visible_rows": effective_stage1_rows,
                "corroborative_rows": len(corroborative_raw_items),
                "normalized_items": len(normalized_items),
                "low_confidence_rows": low_confidence,
                "missing_financial_fields": missing_financial_fields,
                "support_missing_financial_fields": support_missing_financial_fields,
                "missing_item_number": missing_item_number,
                "suspected_noise_rows": suspicious_noise,
                "excluded_primary_rows": review_excluded,
                "excel_primary_rows": excel_primary_count,
                "final_gate": redundant_gate.get("final_decision", "-"),
                "gate_rule": redundant_gate.get("rule_decision", "-"),
                "gate_ai": redundant_gate.get("llm_decision", "-"),
                "gate_iterations": int(redundant_gate.get("iterations_run", 0) or 0),
            },
        ),
        StageSummaryRead(
            stage_code="stage_2_review_validation",
            title="Etapa 2 · Depuración y validación",
            status="review_required" if stage_2_needs_review else "ready",
            consistency_score=82 if not stage_2_needs_review else 58,
            automation_ready=not stage_2_needs_review,
            description=(
                "Esta etapa consolida la fuente primaria, elimina ruido del resumen y marca inconsistencias duras."
            ),
            recommended_action=(
                "Confirma que los artículos consolidados representen la necesidad oficial sin duplicados, omisiones ni filas narrativas."
            ),
            blocking_reasons=(
                ["Hay filas excluidas del resumen que todavía requieren criterio humano."]
                if review_excluded > 0
                else []
            ) + (
                ["Existen inconsistencias documentales pendientes en validación."] if validation_issues > 0 else []
            ),
            metrics={
                "consolidated_items": consolidated_primary_count,
                "excluded_from_summary": review_excluded,
                "validation_issues": validation_issues,
            },
        ),
        StageSummaryRead(
            stage_code="stage_3_benchmark_assessment",
            title="Etapa 3 · Benchmark y viabilidad",
            status="review_required" if stage_3_needs_review else "ready",
            consistency_score=88 if not stage_3_needs_review else 42,
            automation_ready=not stage_3_needs_review,
            description=(
                "Solo vale la pena confiar en esta etapa si las anteriores ya quedaron bien. "
                "Aquí el sistema busca mercado, compara y clasifica viabilidad."
            ),
            recommended_action=(
                "Si el benchmark es débil o no tiene sentido, vuelve a la etapa 1 o usa IA dirigida sobre el proceso o un artículo específico."
            ),
            blocking_reasons=(
                ["Todavía no hay benchmark suficiente para valorar el proceso."] if benchmark_points == 0 else []
            ) + (
                ["No se han generado evaluaciones financieras utilizables."] if financial_assessments == 0 else []
            ),
            metrics={
                "benchmark_points": benchmark_points,
                "financial_assessments": financial_assessments,
            },
        ),
    ]
