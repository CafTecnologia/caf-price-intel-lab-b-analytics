from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from procurement_core.db.base import Base
from procurement_core.models.enums import DocumentKind, ExtractionMethod, FileType, ProcessStatus
from procurement_core.models.orm import (
    ExtractedItemNormalized,
    ExtractedItemRaw,
    FinancialAssessment,
    ProcessDocument,
    ProcurementProcess,
)
from procurement_core.pipelines.analysis import ProcessAnalysisPipeline


def test_structured_source_beats_corroborative_source_for_assessment() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso prioridad fuente", status=ProcessStatus.INGESTED, metadata_json={})
        session.add(process)
        session.flush()

        excel_doc = ProcessDocument(
            process_id=process.id,
            file_name="oferta.xlsx",
            file_hash="hash-excel",
            file_type=FileType.EXCEL,
            document_kind=DocumentKind.PRICE_LIST,
            storage_path="excel",
            metadata_json={},
        )
        pdf_doc = ProcessDocument(
            process_id=process.id,
            file_name="estudio.pdf",
            file_hash="hash-pdf",
            file_type=FileType.PDF,
            document_kind=DocumentKind.PRIOR_STUDY,
            storage_path="pdf",
            metadata_json={},
        )
        session.add_all([excel_doc, pdf_doc])
        session.flush()

        excel_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=excel_doc.id,
            file_name=excel_doc.file_name,
            file_hash=excel_doc.file_hash,
            raw_description="Resma de papel alcalino 500 hojas",
            raw_quantity="24",
            raw_unit="Resma",
            raw_unit_price="21600",
            raw_total="518400",
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="extracted",
            evidence_json={},
        )
        pdf_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=pdf_doc.id,
            file_name=pdf_doc.file_name,
            file_hash=pdf_doc.file_hash,
            raw_description="Resma de papel alcalino 500 hojas",
            raw_quantity="24",
            raw_unit="Resma",
            raw_unit_price=None,
            raw_total=None,
            raw_currency="COP",
            extraction_method=ExtractionMethod.PDF_TABLE,
            extraction_confidence=Decimal("0.88"),
            status="extracted",
            evidence_json={},
        )
        session.add_all([excel_raw, pdf_raw])
        session.flush()

        excel_normalized = ExtractedItemNormalized(
            raw_item_id=excel_raw.id,
            normalized_description=excel_raw.raw_description,
            quantity_num=Decimal("24"),
            unit_normalized="resma",
            unit_price_cop=Decimal("21600"),
            total_cop=Decimal("518400"),
            lot_normalized=None,
            canonical_item_key="resma de papel alcalino 500 hojas",
            metadata_json={},
        )
        pdf_normalized = ExtractedItemNormalized(
            raw_item_id=pdf_raw.id,
            normalized_description=pdf_raw.raw_description,
            quantity_num=Decimal("24"),
            unit_normalized="resma",
            unit_price_cop=None,
            total_cop=None,
            lot_normalized=None,
            canonical_item_key="resma de papel alcalino 500 hojas",
            metadata_json={},
        )
        session.add_all([excel_normalized, pdf_normalized])
        session.commit()

        pipeline = ProcessAnalysisPipeline(session)
        normalized_items = session.execute(select(ExtractedItemNormalized)).scalars().all()
        primary_ids = pipeline._mark_primary_sources(normalized_items)
        pipeline._benchmark_process(process.id)
        session.commit()

        assessments = session.execute(select(FinancialAssessment)).scalars().all()
        assert len(assessments) == 1
        assert excel_normalized.id in primary_ids
        assert pdf_normalized.id not in primary_ids

        excel_meta = session.get(ExtractedItemNormalized, excel_normalized.id).metadata_json
        pdf_meta = session.get(ExtractedItemNormalized, pdf_normalized.id).metadata_json
        assert excel_meta["source_role"] == "primary"
        assert pdf_meta["source_role"] == "corroborative"


def test_support_sheet_unique_item_stays_out_of_primary_summary_when_official_sheet_exists() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso soporte", status=ProcessStatus.INGESTED, metadata_json={})
        session.add(process)
        session.flush()

        excel_doc = ProcessDocument(
            process_id=process.id,
            file_name="estudio.xlsx",
            file_hash="hash-excel",
            file_type=FileType.EXCEL,
            document_kind=DocumentKind.MARKET_STUDY,
            storage_path="excel",
            metadata_json={},
        )
        session.add(excel_doc)
        session.flush()

        official_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=excel_doc.id,
            file_name=excel_doc.file_name,
            file_hash=excel_doc.file_hash,
            sheet_name="ESTUDIO DE MERCADO",
            raw_description="Item oficial",
            raw_quantity="10",
            raw_unit="Unidad",
            raw_unit_price="1000",
            raw_total="10000",
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="extracted",
            evidence_json={"sheet_role": "official", "row_role": "official_item", "item_number": "1"},
        )
        support_only_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=excel_doc.id,
            file_name=excel_doc.file_name,
            file_hash=excel_doc.file_hash,
            sheet_name="Hoja3",
            raw_description="Item solo soporte",
            raw_quantity="5",
            raw_unit="Unidad",
            raw_unit_price=None,
            raw_total=None,
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.90"),
            status="extracted",
            evidence_json={"sheet_role": "support", "row_role": "support_item", "item_number": "2"},
        )
        session.add_all([official_raw, support_only_raw])
        session.flush()

        official_normalized = ExtractedItemNormalized(
            raw_item_id=official_raw.id,
            normalized_description=official_raw.raw_description,
            quantity_num=Decimal("10"),
            unit_normalized="unidad",
            unit_price_cop=Decimal("1000"),
            total_cop=Decimal("10000"),
            lot_normalized=None,
            canonical_item_key="item:1|lot:-",
            metadata_json={"item_number_normalized": "1"},
        )
        support_only_normalized = ExtractedItemNormalized(
            raw_item_id=support_only_raw.id,
            normalized_description=support_only_raw.raw_description,
            quantity_num=Decimal("5"),
            unit_normalized="unidad",
            unit_price_cop=None,
            total_cop=None,
            lot_normalized=None,
            canonical_item_key="item:2|lot:-",
            metadata_json={"item_number_normalized": "2"},
        )
        session.add_all([official_normalized, support_only_normalized])
        session.commit()

        pipeline = ProcessAnalysisPipeline(session)
        normalized_items = session.execute(select(ExtractedItemNormalized)).scalars().all()
        primary_ids = pipeline._mark_primary_sources(normalized_items)

        official_meta = session.get(ExtractedItemNormalized, official_normalized.id).metadata_json
        support_meta = session.get(ExtractedItemNormalized, support_only_normalized.id).metadata_json

        assert official_normalized.id in primary_ids
        assert support_only_normalized.id not in primary_ids
        assert session.get(ExtractedItemRaw, official_raw.id).status == "primary"
        assert session.get(ExtractedItemRaw, support_only_raw.id).status == "support"
        assert official_meta["source_role"] == "primary"
        assert support_meta["source_role"] == "support_only"
