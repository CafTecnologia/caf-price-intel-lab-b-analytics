from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from procurement_core.benchmark.service import BenchmarkService
from procurement_core.extractors.engine import LocalExtractionEngine
from procurement_core.llm.providers import LLMRuntimeConfig, get_llm_provider
from procurement_core.logging import configure_logging
from procurement_core.models.enums import BenchmarkComparability, ProcessStatus, ProviderKind
from procurement_core.models.orm import (
    BenchmarkItem,
    BenchmarkSource,
    DocumentPage,
    ExtractedItemNormalized,
    ExtractedItemRaw,
    FinancialAssessment,
    LLMTaskLog,
    ProcessDocument,
    ProcessReport,
    ProviderConfig,
    ProcurementProcess,
    ReviewDecision,
    ValidationIssue,
)
from procurement_core.services.assessment import build_explanation, classify_financial_gap
from procurement_core.services.normalization import normalize_raw_item
from procurement_core.services.source_selection import is_complete_financial_source, normalized_item_source_score
from procurement_core.services.summary_review import SummaryReviewService
from procurement_core.validation.engine import ValidationEngine


class ProcessAnalysisPipeline:
    def __init__(self, session: Session, benchmark_service: BenchmarkService | None = None, force_ai: bool = False) -> None:
        configure_logging()
        self.session = session
        self.extraction_engine = LocalExtractionEngine()
        self.benchmark_service = benchmark_service or BenchmarkService()
        self.validation_engine = ValidationEngine()
        self.force_ai = force_ai

    def analyze_process(self, process_id: str) -> dict[str, int | str]:
        process = self.session.get(ProcurementProcess, process_id)
        if not process:
            raise ValueError(f"Process {process_id} not found")

        trace: list[dict] = []
        self._reset_process_analysis(process_id)
        documents = (
            self.session.execute(select(ProcessDocument).where(ProcessDocument.process_id == process_id))
            .scalars()
            .all()
        )
        self._record_trace(
            trace,
            stage_code="load_process",
            title="Carga del proceso",
            logic_summary="Se cargó el proceso desde base de datos y se listaron los documentos asociados sin usar IA.",
            inputs={"process_id": process_id},
            outputs={"documents_found": len(documents)},
            used_llm=False,
        )

        extracted_count = 0
        extraction_started = datetime.now(UTC)
        for document in documents:
            extracted_count += self._extract_document(document)
        self._record_trace(
            trace,
            stage_code="local_extraction",
            title="Extracción local",
            logic_summary=(
                "Se ejecutaron extractores locales por tipo de archivo. PDFs nativos se procesan sin OCR, "
                "Excel y Word se leen estructuralmente y no se usó IA para extraer números."
            ),
            inputs={"document_count": len(documents)},
            outputs={"raw_items_extracted": extracted_count},
            used_llm=False,
            started_at=extraction_started,
        )

        normalization_started = datetime.now(UTC)
        self._normalize_process(process_id)
        normalized_items = (
            self.session.execute(
                select(ExtractedItemNormalized)
                .join(ExtractedItemRaw, ExtractedItemRaw.id == ExtractedItemNormalized.raw_item_id)
                .where(ExtractedItemRaw.process_id == process_id)
            )
            .scalars()
            .all()
        )
        self._record_trace(
            trace,
            stage_code="normalization",
            title="Normalización",
            logic_summary=(
                "Se derivaron campos normalizados desde la capa RAW sin sobrescribirla. "
                "Se normalizaron cantidades, unidades, precios y claves canónicas."
            ),
            inputs={"raw_items": extracted_count},
            outputs={"normalized_items": len(normalized_items)},
            used_llm=False,
            started_at=normalization_started,
        )

        source_selection_started = datetime.now(UTC)
        self._mark_primary_sources(normalized_items)
        primary_count = len([item for item in normalized_items if item.raw_item.status == "primary"])
        corroborative_count = len([item for item in normalized_items if item.raw_item.status == "corroborative"])
        self._record_trace(
            trace,
            stage_code="source_selection",
            title="Selección de fuente primaria",
            logic_summary=(
                "Se priorizaron fuentes más completas y estructuradas por ítem. "
                "El sistema favorece orígenes como Excel cuando tienen integridad financiera suficiente."
            ),
            inputs={"normalized_items": len(normalized_items)},
            outputs={"primary_items": primary_count, "corroborative_items": corroborative_count},
            used_llm=False,
            started_at=source_selection_started,
        )

        summary_review_started = datetime.now(UTC)
        summary_review_result = self._review_summary_quality(process, normalized_items)
        self._record_trace(
            trace,
            stage_code="summary_quality_review",
            title="Revisión de calidad del resumen",
            logic_summary=(
                "Se revisaron filas sospechosas antes de consolidarlas para el usuario. "
                "Las reglas duras detectan ruido documental y, si hay proveedor configurado, la IA actúa como segunda opinión sin inventar datos."
            ),
            inputs={"normalized_items": len(normalized_items), "primary_items": primary_count},
            outputs=summary_review_result["summary"],
            used_llm=bool(summary_review_result["summary"].get("used_llm")),
            started_at=summary_review_started,
            llm_provider=summary_review_result.get("llm_provider"),
            llm_model=summary_review_result.get("llm_model"),
        )

        validation_started = datetime.now(UTC)
        self._validate_process(process_id)
        issue_count = self.session.scalar(
            select(func.count(ValidationIssue.id)).where(ValidationIssue.process_id == process_id)
        ) or 0
        self._record_trace(
            trace,
            stage_code="validation",
            title="Validación dura",
            logic_summary=(
                "Se aplicaron reglas aritméticas y de consistencia documental. "
                "Las excepciones se marcaron sin corregir silenciosamente los datos."
            ),
            inputs={"normalized_items": len(normalized_items)},
            outputs={"validation_issues": int(issue_count)},
            used_llm=False,
            started_at=validation_started,
        )

        process.status = ProcessStatus.REVIEW
        self._persist_partial_analysis_state(
            process,
            trace,
            summary={
                "documents": len(documents),
                "raw_items": extracted_count,
                "normalized_items": len(normalized_items),
                "validation_issues": int(issue_count),
                "benchmark_points": 0,
                "financial_assessments": 0,
                "used_llm_anywhere": any(entry.get("used_llm") for entry in trace),
                "analysis_in_progress": True,
            },
            current_stage_code="benchmark_financial",
            current_stage_label="Extracción y validación listas. Iniciando benchmark web.",
            progress_pct=58,
            extra={
                "raw_items": extracted_count,
                "normalized_items": len(normalized_items),
                "validation_issues": int(issue_count),
                "benchmark_points": 0,
                "financial_assessments": 0,
            },
        )

        benchmark_started = datetime.now(UTC)
        benchmark_result = self._benchmark_process(process_id)
        benchmark_count = self.session.scalar(
            select(func.count(BenchmarkItem.id))
            .join(ExtractedItemNormalized, ExtractedItemNormalized.id == BenchmarkItem.normalized_item_id)
            .join(ExtractedItemRaw, ExtractedItemRaw.id == ExtractedItemNormalized.raw_item_id)
            .where(ExtractedItemRaw.process_id == process_id)
        ) or 0
        assessment_count = self.session.scalar(
            select(func.count(FinancialAssessment.id))
            .join(ExtractedItemNormalized, ExtractedItemNormalized.id == FinancialAssessment.normalized_item_id)
            .join(ExtractedItemRaw, ExtractedItemRaw.id == ExtractedItemNormalized.raw_item_id)
            .where(ExtractedItemRaw.process_id == process_id)
        ) or 0
        self._record_trace(
            trace,
            stage_code="benchmark_financial",
            title="Benchmark y evaluación financiera",
            logic_summary=(
                "Se buscaron referencias web y se normalizaron presentaciones comerciales antes de resumir precios. "
                "No se usó IA; el cálculo financiero se hizo con reglas y estadística local."
            ),
            inputs={"primary_items": primary_count},
            outputs={
                "benchmark_points": int(benchmark_count),
                "financial_assessments": int(assessment_count),
                **benchmark_result,
            },
            used_llm=bool(benchmark_result.get("used_llm")),
            started_at=benchmark_started,
            llm_provider=benchmark_result.get("llm_provider"),
            llm_model=benchmark_result.get("llm_model"),
        )
        process.status = ProcessStatus.ANALYZED
        self._persist_analysis_trace(
            process,
            trace,
            summary={
                "documents": len(documents),
                "raw_items": extracted_count,
                "normalized_items": len(normalized_items),
                "validation_issues": int(issue_count),
                "benchmark_points": int(benchmark_count),
                "financial_assessments": int(assessment_count),
                "used_llm_anywhere": any(entry.get("used_llm") for entry in trace),
            },
        )
        self._set_analysis_progress(
            process,
            current_stage_code="completed",
            current_stage_label="Análisis completo terminado.",
            progress_pct=100,
            in_progress=False,
            extra={
                "raw_items": extracted_count,
                "normalized_items": len(normalized_items),
                "validation_issues": int(issue_count),
                "benchmark_points": int(benchmark_count),
                "financial_assessments": int(assessment_count),
            },
        )
        self.session.commit()
        return {"process_id": process_id, "documents": len(documents), "raw_items": extracted_count}

    def run_stage_1(self, process_id: str) -> dict[str, int | str]:
        process = self.session.get(ProcurementProcess, process_id)
        if not process:
            raise ValueError(f"Process {process_id} not found")

        trace: list[dict] = []
        self._reset_process_analysis(process_id)
        documents = (
            self.session.execute(select(ProcessDocument).where(ProcessDocument.process_id == process_id))
            .scalars()
            .all()
        )
        self._record_trace(
            trace,
            stage_code="load_process",
            title="Carga del proceso",
            logic_summary="Se cargó el proceso desde base de datos y se listaron los documentos asociados sin usar IA.",
            inputs={"process_id": process_id},
            outputs={"documents_found": len(documents)},
            used_llm=False,
        )

        extracted_count = 0
        extraction_started = datetime.now(UTC)
        for document in documents:
            extracted_count += self._extract_document(document)
        self._record_trace(
            trace,
            stage_code="local_extraction",
            title="Extracción local",
            logic_summary=(
                "Se ejecutaron extractores locales por tipo de archivo. PDFs nativos se procesan sin OCR, "
                "Excel y Word se leen estructuralmente y no se usó IA para extraer números."
            ),
            inputs={"document_count": len(documents)},
            outputs={"raw_items_extracted": extracted_count},
            used_llm=False,
            started_at=extraction_started,
        )

        normalization_started = datetime.now(UTC)
        self._normalize_process(process_id)
        normalized_items = (
            self.session.execute(
                select(ExtractedItemNormalized)
                .join(ExtractedItemRaw, ExtractedItemRaw.id == ExtractedItemNormalized.raw_item_id)
                .where(ExtractedItemRaw.process_id == process_id)
            )
            .scalars()
            .all()
        )
        self._record_trace(
            trace,
            stage_code="normalization",
            title="Normalización",
            logic_summary=(
                "Se derivaron campos normalizados desde la capa RAW sin sobrescribirla. "
                "Se normalizaron cantidades, unidades, precios y claves canónicas."
            ),
            inputs={"raw_items": extracted_count},
            outputs={"normalized_items": len(normalized_items)},
            used_llm=False,
            started_at=normalization_started,
        )

        source_selection_started = datetime.now(UTC)
        self._mark_primary_sources(normalized_items)
        primary_count = len([item for item in normalized_items if item.raw_item.status == "primary"])
        corroborative_count = len([item for item in normalized_items if item.raw_item.status == "corroborative"])
        self._record_trace(
            trace,
            stage_code="source_selection",
            title="Selección de fuente primaria",
            logic_summary=(
                "Se priorizaron fuentes más completas y estructuradas por ítem. "
                "El sistema favorece orígenes como Excel cuando tienen integridad financiera suficiente."
            ),
            inputs={"normalized_items": len(normalized_items)},
            outputs={"primary_items": primary_count, "corroborative_items": corroborative_count},
            used_llm=False,
            started_at=source_selection_started,
        )

        summary_review_started = datetime.now(UTC)
        summary_review_result = self._review_summary_quality(process, normalized_items)
        self._record_trace(
            trace,
            stage_code="summary_quality_review",
            title="Revisión de calidad del resumen",
            logic_summary=(
                "Se revisaron filas sospechosas antes de consolidarlas para el usuario. "
                "Las reglas duras detectan ruido documental y, si hay proveedor configurado, la IA actúa como segunda opinión sin inventar datos."
            ),
            inputs={"normalized_items": len(normalized_items), "primary_items": primary_count},
            outputs=summary_review_result["summary"],
            used_llm=bool(summary_review_result["summary"].get("used_llm")),
            started_at=summary_review_started,
            llm_provider=summary_review_result.get("llm_provider"),
            llm_model=summary_review_result.get("llm_model"),
        )

        validation_started = datetime.now(UTC)
        self._validate_process(process_id)
        issue_count = self.session.scalar(
            select(func.count(ValidationIssue.id)).where(ValidationIssue.process_id == process_id)
        ) or 0
        self._record_trace(
            trace,
            stage_code="validation",
            title="Validación dura",
            logic_summary=(
                "Se aplicaron reglas aritméticas y de consistencia documental. "
                "Las excepciones se marcaron sin corregir silenciosamente los datos."
            ),
            inputs={"normalized_items": len(normalized_items)},
            outputs={"validation_issues": int(issue_count)},
            used_llm=False,
            started_at=validation_started,
        )

        process.status = ProcessStatus.REVIEW
        self._persist_analysis_trace(
            process,
            trace,
            summary={
                "documents": len(documents),
                "raw_items": extracted_count,
                "normalized_items": len(normalized_items),
                "validation_issues": int(issue_count),
                "benchmark_points": 0,
                "financial_assessments": 0,
                "used_llm_anywhere": any(entry.get("used_llm") for entry in trace),
                "stage_1_only": True,
            },
        )
        self._set_analysis_progress(
            process,
            current_stage_code="completed",
            current_stage_label="Análisis de etapa 1 terminado.",
            progress_pct=100,
            in_progress=False,
            extra={
                "raw_items": extracted_count,
                "normalized_items": len(normalized_items),
                "validation_issues": int(issue_count),
                "benchmark_points": 0,
                "financial_assessments": 0,
            },
        )
        self.session.commit()
        return {"process_id": process_id, "documents": len(documents), "raw_items": extracted_count, "stage": "stage_1"}

    def _record_trace(
        self,
        trace: list[dict],
        *,
        stage_code: str,
        title: str,
        logic_summary: str,
        inputs: dict,
        outputs: dict,
        used_llm: bool,
        started_at: datetime | None = None,
        llm_provider: str | None = None,
        llm_model: str | None = None,
    ) -> None:
        start = started_at or datetime.now(UTC)
        end = datetime.now(UTC)
        trace.append(
            {
                "order": len(trace) + 1,
                "stage_code": stage_code,
                "title": title,
                "status": "completed",
                "started_at": start.isoformat(),
                "finished_at": end.isoformat(),
                "duration_ms": max(0, int((end - start).total_seconds() * 1000)),
                "used_llm": used_llm,
                "llm_provider": llm_provider,
                "llm_model": llm_model,
                "logic_summary": logic_summary,
                "inputs": inputs,
                "outputs": outputs,
            }
        )

    def _persist_analysis_trace(self, process: ProcurementProcess, trace: list[dict], summary: dict) -> None:
        metadata = dict(process.metadata_json or {})
        metadata["analysis_trace"] = trace
        metadata["analysis_summary"] = summary
        process.metadata_json = metadata

        report = self.session.scalar(
            select(ProcessReport).where(
                ProcessReport.process_id == process.id,
                ProcessReport.report_type == "analysis_trace",
            )
        )
        payload = {"summary": summary, "stages": trace}
        if report is None:
            report = ProcessReport(
                process_id=process.id,
                report_type="analysis_trace",
                title="Informe de ejecución del análisis",
                payload_json=payload,
            )
            self.session.add(report)
        else:
            report.title = "Informe de ejecución del análisis"
            report.payload_json = payload

    def _set_analysis_progress(
        self,
        process: ProcurementProcess,
        *,
        current_stage_code: str,
        current_stage_label: str,
        progress_pct: int,
        in_progress: bool,
        extra: dict[str, Any] | None = None,
    ) -> None:
        metadata = dict(process.metadata_json or {})
        metadata["analysis_progress"] = {
            "current_stage_code": current_stage_code,
            "current_stage_label": current_stage_label,
            "progress_pct": int(progress_pct),
            "in_progress": bool(in_progress),
            "updated_at": datetime.now(UTC).isoformat(),
            **(extra or {}),
        }
        process.metadata_json = metadata

    def _persist_partial_analysis_state(
        self,
        process: ProcurementProcess,
        trace: list[dict],
        *,
        summary: dict[str, Any],
        current_stage_code: str,
        current_stage_label: str,
        progress_pct: int,
        extra: dict[str, Any] | None = None,
    ) -> None:
        self._persist_analysis_trace(process, trace, summary)
        self._set_analysis_progress(
            process,
            current_stage_code=current_stage_code,
            current_stage_label=current_stage_label,
            progress_pct=progress_pct,
            in_progress=True,
            extra=extra,
        )
        self.session.commit()

    def _reset_process_analysis(self, process_id: str) -> None:
        process = self.session.get(ProcurementProcess, process_id)
        if process is not None:
            metadata = dict(process.metadata_json or {})
            for key in (
                "analysis_trace",
                "analysis_summary",
                "analysis_progress",
                "stage1_last_auto_fix",
                "stage1_redundant_verdict",
            ):
                metadata.pop(key, None)
            process.metadata_json = metadata
        raw_item_ids = [
            row[0]
            for row in self.session.execute(
                select(ExtractedItemRaw.id).where(ExtractedItemRaw.process_id == process_id)
            ).all()
        ]
        if raw_item_ids:
            normalized_ids = [
                row[0]
                for row in self.session.execute(
                    select(ExtractedItemNormalized.id).where(ExtractedItemNormalized.raw_item_id.in_(raw_item_ids))
                ).all()
            ]
            issue_ids = [
                row[0]
                for row in self.session.execute(
                    select(ValidationIssue.id).where(ValidationIssue.raw_item_id.in_(raw_item_ids))
                ).all()
            ]
            if normalized_ids:
                self.session.execute(delete(FinancialAssessment).where(FinancialAssessment.normalized_item_id.in_(normalized_ids)))
                self.session.execute(delete(BenchmarkItem).where(BenchmarkItem.normalized_item_id.in_(normalized_ids)))
                self.session.execute(delete(ExtractedItemNormalized).where(ExtractedItemNormalized.id.in_(normalized_ids)))
            if issue_ids:
                self.session.execute(delete(ReviewDecision).where(ReviewDecision.issue_id.in_(issue_ids)))
                self.session.execute(delete(ValidationIssue).where(ValidationIssue.id.in_(issue_ids)))
            self.session.execute(delete(ExtractedItemRaw).where(ExtractedItemRaw.id.in_(raw_item_ids)))
        document_ids = [
            row[0]
            for row in self.session.execute(
                select(ProcessDocument.id).where(ProcessDocument.process_id == process_id)
            ).all()
        ]
        if document_ids:
            self.session.execute(delete(DocumentPage).where(DocumentPage.document_id.in_(document_ids)))
        self.session.flush()

    def _extract_document(self, document: ProcessDocument) -> int:
        existing = self.session.scalar(
            select(func.count(ExtractedItemRaw.id)).where(ExtractedItemRaw.document_id == document.id)
        )
        if existing and int(existing) > 0:
            return 0

        profile, batch = self.extraction_engine.extract_document(document)
        document.document_kind = batch.document_kind
        document.page_count = len(batch.pages) if batch.pages else document.page_count
        classification = (batch.metadata or {}).get("classification", {})
        document.classification_confidence = Decimal(str(classification.get("confidence", "0.30")))
        document.metadata_json = {
            **(document.metadata_json or {}),
            "profile": profile.model_dump(mode="json"),
            "classification": classification,
            "extraction_route": profile.route,
        }

        for page in batch.pages:
            self.session.add(
                DocumentPage(
                    document_id=document.id,
                    page_number=page.page_number,
                    sheet_name=page.sheet_name,
                    extracted_text=page.extracted_text,
                    bbox_json=page.bbox,
                    metadata_json=page.metadata,
                )
            )

        for item in batch.items:
            self.session.add(
                ExtractedItemRaw(
                    process_id=document.process_id,
                    document_id=document.id,
                    file_name=document.file_name,
                    file_hash=document.file_hash,
                    lot=item.lot,
                    section=item.section,
                    page_number=item.page_number,
                    sheet_name=item.sheet_name,
                    bbox_json=item.bbox,
                    row_index=item.row_index,
                    cell_range=item.cell_range,
                    raw_description=item.raw_description,
                    raw_quantity=item.raw_quantity,
                    raw_unit=item.raw_unit,
                    raw_unit_price=item.raw_unit_price,
                    raw_total=item.raw_total,
                    raw_currency=item.raw_currency,
                    raw_tax_note=item.raw_tax_note,
                    extraction_method=item.extraction_method,
                    extraction_confidence=item.extraction_confidence,
                    preview_evidence_path=item.preview_evidence_path,
                    evidence_json={
                        **item.evidence,
                        "item_number": item.raw_item_number,
                        "extraction_profile_route": profile.route,
                    },
                    status="extracted",
                )
            )
        self.session.flush()
        return len(batch.items)

    def _normalize_process(self, process_id: str) -> None:
        raw_items = (
            self.session.execute(select(ExtractedItemRaw).where(ExtractedItemRaw.process_id == process_id))
            .scalars()
            .all()
        )
        for raw_item in raw_items:
            if raw_item.normalized_item:
                continue
            self.session.add(ExtractedItemNormalized(raw_item_id=raw_item.id, **normalize_raw_item(raw_item)))
        self.session.flush()

    def _validate_process(self, process_id: str) -> None:
        raw_items = (
            self.session.execute(select(ExtractedItemRaw).where(ExtractedItemRaw.process_id == process_id))
            .scalars()
            .all()
        )
        pairs = [(raw_item, raw_item.normalized_item) for raw_item in raw_items if raw_item.normalized_item]
        issues_by_raw_id = self.validation_engine.evaluate_process(pairs)
        for raw_item in raw_items:
            if raw_item.validation_issues or not raw_item.normalized_item:
                continue
            for issue in issues_by_raw_id.get(raw_item.id, []):
                self.session.add(ValidationIssue(process_id=process_id, raw_item_id=raw_item.id, **issue))
        self.session.flush()

    def _benchmark_process(self, process_id: str) -> dict[str, Any]:
        normalized_items = (
            self.session.execute(
                select(ExtractedItemNormalized)
                .join(ExtractedItemRaw, ExtractedItemRaw.id == ExtractedItemNormalized.raw_item_id)
                .where(ExtractedItemRaw.process_id == process_id)
            )
            .scalars()
            .all()
        )
        primary_ids = self._mark_primary_sources(normalized_items)
        llm_provider, runtime_config = self._get_llm_provider_and_config()
        items_with_llm_search_plan = 0
        items_with_escalated_search = 0
        sources_used: set[str] = set()
        primary_items = [
            normalized
            for normalized in normalized_items
            if normalized.id in primary_ids and normalized.metadata_json.get("summary_include") is not False
        ]
        total_primary_items = len(primary_items)
        processed_primary_items = 0

        for normalized in primary_items:
            description = normalized.normalized_description or normalized.raw_item.raw_description
            if not normalized.benchmark_items:
                benchmark_candidates, benchmark_meta = self.benchmark_service.match_benchmarks_with_trace(
                    description,
                    target_unit=normalized.unit_normalized or normalized.raw_item.raw_unit,
                    llm_provider=llm_provider,
                    force_ai=self.force_ai,
                )
                item_metadata = dict(normalized.metadata_json or {})
                item_metadata["benchmark_search_meta"] = benchmark_meta
                normalized.metadata_json = item_metadata
                if benchmark_meta.get("used_llm"):
                    items_with_llm_search_plan += 1
                if benchmark_meta.get("recovery_plan"):
                    items_with_escalated_search += 1
                for source_name in benchmark_meta.get("sources_consulted", []):
                    sources_used.add(str(source_name))
                recovery_plan = benchmark_meta.get("recovery_plan") or {}
                for source_name in recovery_plan.get("sources", []):
                    sources_used.add(str(source_name))

                for candidate in benchmark_candidates:
                    source = self.session.scalar(
                        select(BenchmarkSource).where(
                            BenchmarkSource.source_name == candidate["source_name"],
                            BenchmarkSource.source_url == candidate["source_url"],
                        )
                    )
                    if source is None:
                        source = BenchmarkSource(
                            source_name=candidate["source_name"],
                            source_url=candidate["source_url"],
                            country=candidate["country"],
                            metadata_json={"seed": True},
                        )
                        self.session.add(source)
                        self.session.flush()
                    self.session.add(
                        BenchmarkItem(
                            normalized_item_id=normalized.id,
                            source_id=source.id,
                            source_url=candidate["source_url"],
                            source_country=candidate["country"],
                            currency=candidate["currency"],
                            original_price=candidate["original_price"],
                            normalized_price_cop=candidate["normalized_price_cop"],
                            commercial_presentation=candidate["commercial_presentation"],
                            condition=candidate["condition"],
                            comparability=BenchmarkComparability(candidate["comparability"]),
                            comparability_score=candidate["comparability_score"],
                            observations=candidate["observations"],
                            evidence_json=candidate["evidence_json"],
                        )
                    )
                self.session.flush()
                self.session.refresh(normalized)

            if normalized.financial_assessment:
                continue
            if normalized.unit_price_cop is None and normalized.total_cop is None:
                continue

            prices = [Decimal(item.normalized_price_cop) for item in normalized.benchmark_items if item.normalized_price_cop is not None]
            filtered_prices, outlier_meta = self.benchmark_service.trim_upper_price_outliers(prices)
            summary = self.benchmark_service.summarize_prices(prices)
            entity_price = normalized.unit_price_cop
            benchmark_median = summary["benchmark_median"]
            gap_cop = entity_price - benchmark_median if entity_price is not None and benchmark_median is not None else None
            gap_pct = (gap_cop / benchmark_median) if gap_cop is not None and benchmark_median not in (None, 0) else None
            classification = classify_financial_gap(gap_pct)
            self.session.add(
                FinancialAssessment(
                    normalized_item_id=normalized.id,
                    price_ref_entity_unit=entity_price,
                    price_ref_entity_total=normalized.total_cop,
                    benchmark_min=summary["benchmark_min"],
                    benchmark_median=summary["benchmark_median"],
                    benchmark_p25=summary["benchmark_p25"],
                    benchmark_p75=summary["benchmark_p75"],
                    benchmark_dispersion=summary["benchmark_dispersion"],
                    estimated_purchase_cost=summary["benchmark_median"],
                    gap_cop=gap_cop,
                    gap_pct=gap_pct,
                    estimated_gross_margin=gap_pct,
                    classification=classification,
                    explanation=build_explanation(classification, gap_pct),
                    metadata_json={
                        "benchmark_points": len(prices),
                        "benchmark_points_filtered": len(filtered_prices),
                        "upper_outlier_filter": outlier_meta,
                    },
                )
            )
            processed_primary_items += 1
            if processed_primary_items % 3 == 0 or processed_primary_items == total_primary_items:
                benchmark_count = self.session.scalar(
                    select(func.count(BenchmarkItem.id))
                    .join(ExtractedItemNormalized, ExtractedItemNormalized.id == BenchmarkItem.normalized_item_id)
                    .join(ExtractedItemRaw, ExtractedItemRaw.id == ExtractedItemNormalized.raw_item_id)
                    .where(ExtractedItemRaw.process_id == process_id)
                ) or 0
                assessment_count = self.session.scalar(
                    select(func.count(FinancialAssessment.id))
                    .join(ExtractedItemNormalized, ExtractedItemNormalized.id == FinancialAssessment.normalized_item_id)
                    .join(ExtractedItemRaw, ExtractedItemRaw.id == ExtractedItemNormalized.raw_item_id)
                    .where(ExtractedItemRaw.process_id == process_id)
                ) or 0
                process = self.session.get(ProcurementProcess, process_id)
                if process is not None:
                    progress_pct = 58
                    if total_primary_items > 0:
                        progress_pct = min(96, 58 + int((processed_primary_items / total_primary_items) * 38))
                    self._set_analysis_progress(
                        process,
                        current_stage_code="benchmark_financial",
                        current_stage_label=(
                            f"Benchmark web en curso: {processed_primary_items}/{total_primary_items} artículos procesados."
                        ),
                        progress_pct=progress_pct,
                        in_progress=True,
                        extra={
                            "raw_items": len(normalized_items),
                            "normalized_items": len(normalized_items),
                            "benchmark_points": int(benchmark_count),
                            "financial_assessments": int(assessment_count),
                            "items_with_llm_search_plan": items_with_llm_search_plan,
                            "items_with_escalated_search": items_with_escalated_search,
                        },
                    )
                    self.session.commit()
        self.session.flush()
        return {
            "used_llm": items_with_llm_search_plan > 0,
            "items_with_llm_search_plan": items_with_llm_search_plan,
            "items_with_escalated_search": items_with_escalated_search,
            "sources_used": sorted(sources_used),
            "llm_provider": runtime_config.provider_name.value if items_with_llm_search_plan > 0 and runtime_config else None,
            "llm_model": runtime_config.model_name if items_with_llm_search_plan > 0 and runtime_config else None,
        }

    def _mark_primary_sources(self, normalized_items: list[ExtractedItemNormalized]) -> set[str]:
        groups: dict[str, list[ExtractedItemNormalized]] = {}
        primary_ids: set[str] = set()
        document_has_official_sheet_rows: dict[str, bool] = {}

        for normalized in normalized_items:
            key = normalized.canonical_item_key or f"raw:{normalized.raw_item_id}"
            groups.setdefault(key, []).append(normalized)
            evidence = normalized.raw_item.evidence_json or {}
            if evidence.get("sheet_role") == "official" and evidence.get("row_role") == "official_item":
                document_has_official_sheet_rows[normalized.raw_item.document_id] = True

        for items in groups.values():
            ranked = sorted(items, key=normalized_item_source_score, reverse=True)
            primary = ranked[0]
            primary_evidence = primary.raw_item.evidence_json or {}
            support_only_group = (
                document_has_official_sheet_rows.get(primary.raw_item.document_id, False)
                and primary_evidence.get("sheet_role") == "support"
            )

            if not support_only_group:
                primary_ids.add(primary.id)

            for index, item in enumerate(ranked):
                metadata = dict(item.metadata_json or {})
                if support_only_group:
                    metadata["source_role"] = "support_only"
                    item.raw_item.status = "support"
                else:
                    metadata["source_role"] = "primary" if item.id == primary.id else "corroborative"
                    item.raw_item.status = "primary" if item.id == primary.id else "corroborative"
                metadata["source_rank"] = index + 1
                metadata["source_score"] = normalized_item_source_score(item)
                metadata["primary_source_document_id"] = primary.raw_item.document_id
                metadata["is_complete_financial_source"] = is_complete_financial_source(item)
                metadata["duplicate_cluster_size"] = len(ranked)
                item.metadata_json = metadata

        self.session.flush()
        return primary_ids

    def _review_summary_quality(
        self,
        process: ProcurementProcess,
        normalized_items: list[ExtractedItemNormalized],
    ) -> dict[str, Any]:
        provider, runtime_config = self._get_llm_provider_and_config()
        service = SummaryReviewService(llm_provider=provider)
        decisions, summary = service.review(normalized_items)

        decision_map = {decision.normalized_item_id: decision for decision in decisions}
        for normalized in normalized_items:
            decision = decision_map.get(normalized.id)
            if decision is None:
                continue
            metadata = dict(normalized.metadata_json or {})
            metadata["summary_include"] = decision.include_in_summary
            metadata["summary_review_reason"] = decision.reason
            metadata["summary_review_flags"] = decision.flags
            metadata["summary_review_probable_matches"] = decision.probable_matches
            metadata["summary_review_used_llm"] = decision.used_llm
            metadata["summary_review_llm_decision"] = decision.llm_decision
            metadata["summary_review_llm_matched_item_number"] = decision.llm_matched_item_number
            normalized.metadata_json = metadata

        llm_used = bool(summary.get("used_llm"))
        if llm_used and runtime_config is not None:
            self.session.add(
                LLMTaskLog(
                    process_id=process.id,
                    provider_name=runtime_config.provider_name,
                    task_name="summary_quality_review",
                    model_name=runtime_config.model_name,
                    prompt_json={
                        "process_id": process.id,
                        "normalized_items": len(normalized_items),
                        "suspicious_items": summary.get("suspicious_items", 0),
                    },
                    response_json={"summary": summary},
                    estimated_cost_usd=Decimal("0"),
                    succeeded=True,
                )
            )
        self.session.flush()
        return {
            "summary": summary,
            "llm_provider": runtime_config.provider_name.value if llm_used and runtime_config is not None else None,
            "llm_model": runtime_config.model_name if llm_used and runtime_config is not None else None,
        }

    def _get_llm_provider_and_config(self) -> tuple[object, LLMRuntimeConfig | None]:
        stored = self.session.scalar(select(ProviderConfig).limit(1))
        if stored is None:
            return get_llm_provider(), None
        if not stored.enabled:
            disabled_config = LLMRuntimeConfig(
                provider_name=ProviderKind.DISABLED,
                base_url=stored.base_url or "",
                api_key="",
                model_name=stored.model_name or "disabled",
                timeout_seconds=int(stored.config_json.get("timeout_seconds", 30)),
                max_task_budget_usd=float(stored.config_json.get("max_task_budget_usd", 2.5)),
                estimated_input_token_price=float(stored.config_json.get("estimated_input_token_price", 0.0)),
                estimated_output_token_price=float(stored.config_json.get("estimated_output_token_price", 0.0)),
                extra_headers={str(k): str(v) for k, v in (stored.config_json.get("extra_headers", {}) or {}).items()},
            )
            return get_llm_provider(disabled_config), disabled_config
        runtime_config = LLMRuntimeConfig(
            provider_name=stored.provider_name,
            base_url=stored.base_url or "",
            api_key=str(stored.config_json.get("api_key") or ""),
            model_name=stored.model_name or "",
            timeout_seconds=int(stored.config_json.get("timeout_seconds", 30)),
            max_task_budget_usd=float(stored.config_json.get("max_task_budget_usd", 2.5)),
            estimated_input_token_price=float(stored.config_json.get("estimated_input_token_price", 0.0000005)),
            estimated_output_token_price=float(stored.config_json.get("estimated_output_token_price", 0.0000015)),
            extra_headers={str(k): str(v) for k, v in (stored.config_json.get("extra_headers", {}) or {}).items()},
        )
        return get_llm_provider(runtime_config), runtime_config
