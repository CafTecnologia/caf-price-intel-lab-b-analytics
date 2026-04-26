from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from procurement_core.db.base import Base
from procurement_core.models.enums import (
    AssessmentClassification,
    BenchmarkComparability,
    DocumentKind,
    ExtractionMethod,
    FileType,
    IssueType,
    ProcessStatus,
    ProviderKind,
    ReviewStatus,
    Severity,
)


def utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )


class ProcurementProcess(TimestampMixin, Base):
    __tablename__ = "procurement_process"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    external_reference: Mapped[str | None] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    contracting_entity: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(String(512))
    status: Mapped[ProcessStatus] = mapped_column(Enum(ProcessStatus, native_enum=False), default=ProcessStatus.DRAFT)
    currency: Mapped[str] = mapped_column(String(8), default="COP", nullable=False)
    trm: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    metadata_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    documents: Mapped[list["ProcessDocument"]] = relationship(back_populates="process", cascade="all, delete-orphan")
    raw_items: Mapped[list["ExtractedItemRaw"]] = relationship(back_populates="process", cascade="all, delete-orphan")
    reports: Mapped[list["ProcessReport"]] = relationship(back_populates="process", cascade="all, delete-orphan")


class ProcessDocument(TimestampMixin, Base):
    __tablename__ = "process_document"
    __table_args__ = (
        UniqueConstraint("process_id", "file_hash", name="uq_process_document_hash"),
        Index("ix_process_document_kind", "document_kind"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    process_id: Mapped[str] = mapped_column(ForeignKey("procurement_process.id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    mime_type: Mapped[str | None] = mapped_column(String(128))
    file_type: Mapped[FileType] = mapped_column(Enum(FileType, native_enum=False), nullable=False)
    document_kind: Mapped[DocumentKind] = mapped_column(
        Enum(DocumentKind, native_enum=False),
        default=DocumentKind.UNKNOWN,
        nullable=False,
    )
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    thumbnail_path: Mapped[str | None] = mapped_column(String(512))
    page_count: Mapped[int | None] = mapped_column(Integer)
    classification_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    metadata_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    process: Mapped["ProcurementProcess"] = relationship(back_populates="documents")
    pages: Mapped[list["DocumentPage"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    raw_items: Mapped[list["ExtractedItemRaw"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class DocumentPage(TimestampMixin, Base):
    __tablename__ = "document_page"
    __table_args__ = (UniqueConstraint("document_id", "page_number", "sheet_name", name="uq_document_page_slot"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(ForeignKey("process_document.id", ondelete="CASCADE"), nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer)
    sheet_name: Mapped[str | None] = mapped_column(String(128))
    extracted_text: Mapped[str | None] = mapped_column(Text)
    bbox_json: Mapped[dict | None] = mapped_column(SQLiteJSON)
    preview_path: Mapped[str | None] = mapped_column(String(512))
    metadata_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    document: Mapped["ProcessDocument"] = relationship(back_populates="pages")


class ExtractedItemRaw(TimestampMixin, Base):
    __tablename__ = "extracted_item_raw"
    __table_args__ = (
        Index("ix_extracted_item_raw_process_document", "process_id", "document_id"),
        Index("ix_extracted_item_raw_lot", "lot"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    process_id: Mapped[str] = mapped_column(ForeignKey("procurement_process.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("process_document.id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    lot: Mapped[str | None] = mapped_column(String(255))
    section: Mapped[str | None] = mapped_column(String(255))
    page_number: Mapped[int | None] = mapped_column(Integer)
    sheet_name: Mapped[str | None] = mapped_column(String(128))
    bbox_json: Mapped[dict | None] = mapped_column(SQLiteJSON)
    row_index: Mapped[int | None] = mapped_column(Integer)
    cell_range: Mapped[str | None] = mapped_column(String(64))
    raw_description: Mapped[str] = mapped_column(Text, nullable=False)
    raw_quantity: Mapped[str | None] = mapped_column(String(128))
    raw_unit: Mapped[str | None] = mapped_column(String(128))
    raw_unit_price: Mapped[str | None] = mapped_column(String(128))
    raw_total: Mapped[str | None] = mapped_column(String(128))
    raw_currency: Mapped[str | None] = mapped_column(String(16))
    raw_tax_note: Mapped[str | None] = mapped_column(String(128))
    extraction_method: Mapped[ExtractionMethod] = mapped_column(Enum(ExtractionMethod, native_enum=False), nullable=False)
    extraction_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    preview_evidence_path: Mapped[str | None] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    evidence_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    process: Mapped["ProcurementProcess"] = relationship(back_populates="raw_items")
    document: Mapped["ProcessDocument"] = relationship(back_populates="raw_items")
    normalized_item: Mapped["ExtractedItemNormalized | None"] = relationship(back_populates="raw_item", uselist=False)
    validation_issues: Mapped[list["ValidationIssue"]] = relationship(back_populates="raw_item", cascade="all, delete-orphan")


class ExtractedItemNormalized(TimestampMixin, Base):
    __tablename__ = "extracted_item_normalized"
    __table_args__ = (
        UniqueConstraint("raw_item_id", name="uq_normalized_raw_item"),
        Index("ix_extracted_item_normalized_canonical", "canonical_item_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    raw_item_id: Mapped[str] = mapped_column(ForeignKey("extracted_item_raw.id", ondelete="CASCADE"), nullable=False)
    normalized_description: Mapped[str | None] = mapped_column(Text)
    quantity_num: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    unit_normalized: Mapped[str | None] = mapped_column(String(64))
    unit_price_cop: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    total_cop: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    vat_mode: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    presentation_detected: Mapped[str | None] = mapped_column(String(128))
    brand_detected: Mapped[str | None] = mapped_column(String(128))
    model_detected: Mapped[str | None] = mapped_column(String(128))
    lot_normalized: Mapped[str | None] = mapped_column(String(255))
    canonical_item_key: Mapped[str | None] = mapped_column(String(255))
    metadata_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    raw_item: Mapped["ExtractedItemRaw"] = relationship(back_populates="normalized_item")
    benchmark_items: Mapped[list["BenchmarkItem"]] = relationship(back_populates="normalized_item", cascade="all, delete-orphan")
    financial_assessment: Mapped["FinancialAssessment | None"] = relationship(back_populates="normalized_item", uselist=False)


class ValidationIssue(TimestampMixin, Base):
    __tablename__ = "validation_issue"
    __table_args__ = (
        Index("ix_validation_issue_process", "process_id"),
        Index("ix_validation_issue_severity", "severity"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    process_id: Mapped[str] = mapped_column(ForeignKey("procurement_process.id", ondelete="CASCADE"), nullable=False)
    raw_item_id: Mapped[str | None] = mapped_column(ForeignKey("extracted_item_raw.id", ondelete="CASCADE"))
    issue_type: Mapped[IssueType] = mapped_column(Enum(IssueType, native_enum=False), nullable=False)
    severity: Mapped[Severity] = mapped_column(Enum(Severity, native_enum=False), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_value: Mapped[str | None] = mapped_column(Text)
    evidence_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)
    status: Mapped[ReviewStatus] = mapped_column(Enum(ReviewStatus, native_enum=False), default=ReviewStatus.PENDING)

    raw_item: Mapped["ExtractedItemRaw | None"] = relationship(back_populates="validation_issues")
    decisions: Mapped[list["ReviewDecision"]] = relationship(back_populates="issue", cascade="all, delete-orphan")


class ReviewDecision(TimestampMixin, Base):
    __tablename__ = "review_decision"
    __table_args__ = (Index("ix_review_decision_issue", "issue_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    issue_id: Mapped[str] = mapped_column(ForeignKey("validation_issue.id", ondelete="CASCADE"), nullable=False)
    reviewer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[ReviewStatus] = mapped_column(Enum(ReviewStatus, native_enum=False), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    corrected_value_json: Mapped[dict | None] = mapped_column(SQLiteJSON)

    issue: Mapped["ValidationIssue"] = relationship(back_populates="decisions")


class BenchmarkSource(TimestampMixin, Base):
    __tablename__ = "benchmark_source"
    __table_args__ = (UniqueConstraint("source_name", "source_url", name="uq_benchmark_source"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[str] = mapped_column(String(512), nullable=False)
    country: Mapped[str | None] = mapped_column(String(64))
    metadata_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    benchmark_items: Mapped[list["BenchmarkItem"]] = relationship(back_populates="source")


class BenchmarkItem(TimestampMixin, Base):
    __tablename__ = "benchmark_item"
    __table_args__ = (
        Index("ix_benchmark_item_normalized", "normalized_item_id"),
        Index("ix_benchmark_item_captured_at", "captured_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    normalized_item_id: Mapped[str] = mapped_column(ForeignKey("extracted_item_normalized.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[str] = mapped_column(ForeignKey("benchmark_source.id", ondelete="CASCADE"), nullable=False)
    source_url: Mapped[str] = mapped_column(String(512), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    source_country: Mapped[str | None] = mapped_column(String(64))
    currency: Mapped[str] = mapped_column(String(8), nullable=False)
    original_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    normalized_price_cop: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    commercial_presentation: Mapped[str | None] = mapped_column(String(128))
    condition: Mapped[str | None] = mapped_column(String(64))
    comparability: Mapped[BenchmarkComparability] = mapped_column(
        Enum(BenchmarkComparability, native_enum=False),
        default=BenchmarkComparability.ORIENTATIVE,
        nullable=False,
    )
    comparability_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    observations: Mapped[str | None] = mapped_column(Text)
    evidence_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    normalized_item: Mapped["ExtractedItemNormalized"] = relationship(back_populates="benchmark_items")
    source: Mapped["BenchmarkSource"] = relationship(back_populates="benchmark_items")


class FinancialAssessment(TimestampMixin, Base):
    __tablename__ = "financial_assessment"
    __table_args__ = (
        UniqueConstraint("normalized_item_id", name="uq_financial_assessment_item"),
        CheckConstraint("gap_pct >= -9999 AND gap_pct <= 9999", name="ck_financial_assessment_gap_pct"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    normalized_item_id: Mapped[str] = mapped_column(
        ForeignKey("extracted_item_normalized.id", ondelete="CASCADE"),
        nullable=False,
    )
    price_ref_entity_unit: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    price_ref_entity_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    benchmark_min: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    benchmark_median: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    benchmark_p25: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    benchmark_p75: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    benchmark_dispersion: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    estimated_purchase_cost: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    gap_cop: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    gap_pct: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    estimated_gross_margin: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    classification: Mapped[AssessmentClassification] = mapped_column(
        Enum(AssessmentClassification, native_enum=False),
        default=AssessmentClassification.UNKNOWN,
        nullable=False,
    )
    explanation: Mapped[str | None] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    normalized_item: Mapped["ExtractedItemNormalized"] = relationship(back_populates="financial_assessment")


class ProcessReport(TimestampMixin, Base):
    __tablename__ = "process_report"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    process_id: Mapped[str] = mapped_column(ForeignKey("procurement_process.id", ondelete="CASCADE"), nullable=False)
    report_type: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str | None] = mapped_column(String(512))
    payload_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)

    process: Mapped["ProcurementProcess"] = relationship(back_populates="reports")


class LLMTaskLog(TimestampMixin, Base):
    __tablename__ = "llm_task_log"
    __table_args__ = (Index("ix_llm_task_log_process", "process_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    process_id: Mapped[str | None] = mapped_column(ForeignKey("procurement_process.id", ondelete="CASCADE"))
    provider_name: Mapped[ProviderKind] = mapped_column(Enum(ProviderKind, native_enum=False), nullable=False)
    task_name: Mapped[str] = mapped_column(String(128), nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)
    response_json: Mapped[dict | None] = mapped_column(SQLiteJSON)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    estimated_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    succeeded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)


class ProviderConfig(TimestampMixin, Base):
    __tablename__ = "provider_config"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    provider_name: Mapped[ProviderKind] = mapped_column(Enum(ProviderKind, native_enum=False), nullable=False, unique=True)
    base_url: Mapped[str | None] = mapped_column(String(512))
    model_name: Mapped[str | None] = mapped_column(String(128))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config_json: Mapped[dict] = mapped_column(SQLiteJSON, default=dict, nullable=False)


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_entity", "entity_type", "entity_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    actor: Mapped[str | None] = mapped_column(String(255))
    before_json: Mapped[dict | None] = mapped_column(SQLiteJSON)
    after_json: Mapped[dict | None] = mapped_column(SQLiteJSON)
    reason: Mapped[str | None] = mapped_column(Text)
