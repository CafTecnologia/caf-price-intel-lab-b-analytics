from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from procurement_core.models.enums import AssessmentClassification, DocumentKind, FileType, ProcessStatus, Severity
from procurement_core.schemas.common import JsonDict, ProcurementBaseModel, TimestampedRead


class ProcessCreate(ProcurementBaseModel):
    external_reference: str | None = None
    name: str
    contracting_entity: str | None = None
    description: str | None = None
    source_url: str | None = None
    currency: str = "COP"
    trm: Decimal | None = None


class ProcessRead(TimestampedRead):
    external_reference: str | None
    name: str
    contracting_entity: str | None
    description: str | None
    source_url: str | None
    status: ProcessStatus
    currency: str
    trm: Decimal | None
    metadata_json: JsonDict = Field(default_factory=dict)


class DocumentRead(TimestampedRead):
    process_id: str
    file_name: str
    file_hash: str
    mime_type: str | None
    file_type: FileType
    document_kind: DocumentKind
    storage_path: str
    page_count: int | None
    metadata_json: JsonDict = Field(default_factory=dict)


class RawItemRead(TimestampedRead):
    process_id: str
    document_id: str
    file_name: str
    file_hash: str
    item_number: str | None = None
    lot: str | None
    section: str | None
    page_number: int | None
    sheet_name: str | None
    raw_description: str
    raw_quantity: str | None
    raw_unit: str | None
    raw_unit_price: str | None
    raw_total: str | None
    extraction_method: str
    extraction_confidence: Decimal | None
    status: str
    origin: str | None = None


class ConsolidatedItemRead(ProcurementBaseModel):
    raw_item_id: str
    normalized_item_id: str | None = None
    item_number: str | None = None
    raw_description: str
    raw_quantity: str | None = None
    raw_unit: str | None = None
    raw_unit_price: str | None = None
    raw_total: str | None = None
    origin: str | None = None
    file_name: str
    source_count: int = 1
    canonical_item_key: str | None = None
    lot: str | None = None


class NormalizedItemRead(TimestampedRead):
    raw_item_id: str
    normalized_description: str | None
    quantity_num: Decimal | None
    unit_normalized: str | None
    unit_price_cop: Decimal | None
    total_cop: Decimal | None
    lot_normalized: str | None
    canonical_item_key: str | None


class ValidationIssueRead(TimestampedRead):
    process_id: str
    raw_item_id: str | None
    issue_type: str
    severity: Severity
    title: str
    message: str
    suggested_value: str | None
    status: str


class FinancialAssessmentRead(TimestampedRead):
    normalized_item_id: str
    price_ref_entity_unit: Decimal | None
    price_ref_entity_total: Decimal | None
    benchmark_median: Decimal | None
    gap_cop: Decimal | None
    gap_pct: Decimal | None
    estimated_gross_margin: Decimal | None
    classification: AssessmentClassification
    explanation: str | None


class BenchmarkSourceDetailRead(ProcurementBaseModel):
    source_name: str
    source_url: str
    country: str | None = None
    currency: str
    original_price: Decimal | None = None
    normalized_price_cop: Decimal | None = None
    commercial_presentation: str | None = None
    condition: str | None = None
    comparability: str | None = None
    comparability_score: Decimal | None = None
    observations: str | None = None
    evidence_json: JsonDict = Field(default_factory=dict)


class FinancialAssessmentDetailRead(FinancialAssessmentRead):
    item_number: str | None = None
    raw_item_id: str | None = None
    raw_description: str | None = None
    raw_quantity: str | None = None
    raw_unit: str | None = None
    raw_unit_price: str | None = None
    raw_total: str | None = None
    origin: str | None = None
    benchmark_min: Decimal | None = None
    benchmark_p25: Decimal | None = None
    benchmark_p75: Decimal | None = None
    benchmark_dispersion: Decimal | None = None
    benchmark_points: int = 0
    benchmark_sources: list[BenchmarkSourceDetailRead] = Field(default_factory=list)


class AnalysisTraceEntryRead(ProcurementBaseModel):
    order: int
    stage_code: str
    title: str
    status: str
    started_at: str
    finished_at: str
    duration_ms: int
    used_llm: bool = False
    llm_provider: str | None = None
    llm_model: str | None = None
    logic_summary: str
    inputs: JsonDict = Field(default_factory=dict)
    outputs: JsonDict = Field(default_factory=dict)


class StageSummaryRead(ProcurementBaseModel):
    stage_code: str
    title: str
    status: str
    consistency_score: int = 0
    automation_ready: bool = False
    description: str
    recommended_action: str
    blocking_reasons: list[str] = Field(default_factory=list)
    metrics: JsonDict = Field(default_factory=dict)


class Stage1AutoFixSnapshotRead(ProcurementBaseModel):
    summary: str
    used_llm: bool = False
    provider_name: str | None = None
    model_name: str | None = None
    actions_applied: list[JsonDict] = Field(default_factory=list)
    before_metrics: JsonDict = Field(default_factory=dict)
    after_metrics: JsonDict = Field(default_factory=dict)
    before_score: int | None = None
    after_score: int | None = None
    stage_status_after: str | None = None
    blockers_after: list[str] = Field(default_factory=list)
    iterations: list[JsonDict] = Field(default_factory=list)
    stop_reason: str | None = None
    redundant_verdict: JsonDict = Field(default_factory=dict)


class ProcessDetail(ProcurementBaseModel):
    process: ProcessRead
    documents: list[DocumentRead]
    consolidated_items: list[ConsolidatedItemRead]
    raw_items: list[RawItemRead]
    normalized_items: list[NormalizedItemRead]
    issues: list[ValidationIssueRead]
    assessments: list[FinancialAssessmentDetailRead]
    analysis_trace: list[AnalysisTraceEntryRead] = Field(default_factory=list)
    stage_summaries: list[StageSummaryRead] = Field(default_factory=list)
    stage1_last_auto_fix: Stage1AutoFixSnapshotRead | None = None


class DashboardSummary(ProcurementBaseModel):
    total_processes: int
    analyzed_processes: int
    total_items: int
    open_issues: int
    classification_counts: JsonDict = Field(default_factory=dict)
