from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from procurement_api.presenters import build_process_detail
from procurement_api.services import ask_process_ai
from procurement_core.db.base import Base
from procurement_core.models.enums import DocumentKind, ExtractionMethod, FileType, ProcessStatus
from procurement_core.models.orm import ExtractedItemNormalized, ExtractedItemRaw, ProcessDocument, ProcurementProcess


def test_process_detail_consolidates_primary_items_only() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso presenter", status=ProcessStatus.ANALYZED, metadata_json={})
        session.add(process)
        session.flush()

        excel_doc = ProcessDocument(
            process_id=process.id,
            file_name="presupuesto.xlsx",
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
            document_kind=DocumentKind.TECHNICAL_ANNEX,
            storage_path="pdf",
            metadata_json={},
        )
        session.add_all([excel_doc, pdf_doc])
        session.flush()

        primary_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=excel_doc.id,
            file_name=excel_doc.file_name,
            file_hash=excel_doc.file_hash,
            page_number=None,
            sheet_name="Hoja 1",
            raw_description="Guante de nitrilo talla M",
            raw_quantity="10",
            raw_unit="Caja",
            raw_unit_price="10000",
            raw_total="100000",
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="primary",
            evidence_json={"item_number": "1"},
        )
        corroborative_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=pdf_doc.id,
            file_name=pdf_doc.file_name,
            file_hash=pdf_doc.file_hash,
            page_number=15,
            sheet_name=None,
            raw_description="Guante de nitrilo talla M",
            raw_quantity="10",
            raw_unit="Caja",
            raw_unit_price=None,
            raw_total=None,
            raw_currency="COP",
            extraction_method=ExtractionMethod.PDF_TABLE,
            extraction_confidence=Decimal("0.88"),
            status="corroborative",
            evidence_json={"item_number": "1"},
        )
        session.add_all([primary_raw, corroborative_raw])
        session.flush()

        session.add_all(
            [
                ExtractedItemNormalized(
                    raw_item_id=primary_raw.id,
                    normalized_description=primary_raw.raw_description,
                    quantity_num=Decimal("10"),
                    unit_normalized="caja",
                    unit_price_cop=Decimal("10000"),
                    total_cop=Decimal("100000"),
                    lot_normalized=None,
                    canonical_item_key="item:1|lot:-",
                    metadata_json={"item_number": "1", "item_number_normalized": "1", "duplicate_cluster_size": 2},
                ),
                ExtractedItemNormalized(
                    raw_item_id=corroborative_raw.id,
                    normalized_description=corroborative_raw.raw_description,
                    quantity_num=Decimal("10"),
                    unit_normalized="caja",
                    unit_price_cop=None,
                    total_cop=None,
                    lot_normalized=None,
                    canonical_item_key="item:1|lot:-",
                    metadata_json={"item_number": "1", "item_number_normalized": "1", "duplicate_cluster_size": 2},
                ),
            ]
        )
        session.commit()

        detail = build_process_detail(process, [excel_doc, pdf_doc], [])

        assert len(detail.consolidated_items) == 1
        consolidated = detail.consolidated_items[0]
        assert consolidated.item_number == "1"
        assert consolidated.raw_description == "Guante de nitrilo talla M"
        assert consolidated.origin == "presupuesto.xlsx | Hoja 1"
        assert consolidated.source_count == 2
        assert len(detail.raw_items) == 2
        assert detail.stage_summaries[0].consistency_score >= 90
        assert detail.stage_summaries[0].status == "ready"
        assert detail.stage_summaries[0].metrics["missing_financial_fields"] == 0
        assert detail.stage_summaries[0].metrics["support_missing_financial_fields"] == 1


def test_process_detail_hides_primary_rows_excluded_from_summary() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso presenter", status=ProcessStatus.ANALYZED, metadata_json={})
        session.add(process)
        session.flush()

        excel_doc = ProcessDocument(
            process_id=process.id,
            file_name="presupuesto.xlsx",
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
            document_kind=DocumentKind.TECHNICAL_ANNEX,
            storage_path="pdf",
            metadata_json={},
        )
        session.add_all([excel_doc, pdf_doc])
        session.flush()

        visible_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=excel_doc.id,
            file_name=excel_doc.file_name,
            file_hash=excel_doc.file_hash,
            sheet_name="Hoja 1",
            raw_description="Guante de nitrilo talla M",
            raw_quantity="10",
            raw_unit="Caja",
            raw_unit_price="10000",
            raw_total="100000",
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="primary",
            evidence_json={"item_number": "1"},
        )
        excluded_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=pdf_doc.id,
            file_name=pdf_doc.file_name,
            file_hash=pdf_doc.file_hash,
            page_number=10,
            raw_description="Texto narrativo sin estructura",
            raw_quantity=None,
            raw_unit="Texto narrativo sin estructura",
            raw_unit_price=None,
            raw_total="Texto narrativo sin estructura",
            raw_currency="COP",
            extraction_method=ExtractionMethod.PDF_TABLE,
            extraction_confidence=Decimal("0.82"),
            status="primary",
            evidence_json={},
        )
        session.add_all([visible_raw, excluded_raw])
        session.flush()

        session.add_all(
            [
                ExtractedItemNormalized(
                    raw_item_id=visible_raw.id,
                    normalized_description=visible_raw.raw_description,
                    quantity_num=Decimal("10"),
                    unit_normalized="caja",
                    unit_price_cop=Decimal("10000"),
                    total_cop=Decimal("100000"),
                    lot_normalized=None,
                    canonical_item_key="item:1|lot:-",
                    metadata_json={"item_number": "1", "item_number_normalized": "1", "summary_include": True},
                ),
                ExtractedItemNormalized(
                    raw_item_id=excluded_raw.id,
                    normalized_description=excluded_raw.raw_description,
                    quantity_num=None,
                    unit_normalized=None,
                    unit_price_cop=None,
                    total_cop=None,
                    lot_normalized=None,
                    canonical_item_key="desc:texto narrativo",
                    metadata_json={"summary_include": False},
                ),
            ]
        )
        session.commit()

        detail = build_process_detail(process, [excel_doc, pdf_doc], [])

        assert len(detail.consolidated_items) == 1
        assert detail.consolidated_items[0].raw_item_id == visible_raw.id
        assert len(detail.raw_items) == 2
        assert detail.stage_summaries[0].consistency_score <= 80
        assert detail.stage_summaries[0].status == "review_required"


def test_process_detail_accepts_derived_total_as_financial_basis() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso derivado", status=ProcessStatus.REVIEW, metadata_json={})
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

        raw_item = ExtractedItemRaw(
            process_id=process.id,
            document_id=excel_doc.id,
            file_name=excel_doc.file_name,
            file_hash=excel_doc.file_hash,
            sheet_name="Table 1",
            raw_description="CANDADO MEDIANO",
            raw_quantity="12",
            raw_unit="Unidad",
            raw_unit_price=None,
            raw_total="840000",
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="primary",
            evidence_json={"item_number": "1", "financial_basis_role": "total"},
        )
        session.add(raw_item)
        session.flush()

        session.add(
            ExtractedItemNormalized(
                raw_item_id=raw_item.id,
                normalized_description=raw_item.raw_description,
                quantity_num=Decimal("12"),
                unit_normalized="unidad",
                unit_price_cop=Decimal("70000"),
                total_cop=Decimal("840000"),
                lot_normalized=None,
                canonical_item_key="item:1|lot:-",
                metadata_json={
                    "item_number": "1",
                    "item_number_normalized": "1",
                    "derived_unit_price_from_total": True,
                    "financial_basis_role": "total",
                },
            )
        )
        session.commit()

        detail = build_process_detail(process, [excel_doc], [])

        assert detail.stage_summaries[0].status == "ready"
        assert detail.stage_summaries[0].metrics["missing_financial_fields"] == 0


def test_process_detail_reads_stage1_autofix_snapshot() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(
            name="Proceso autofix",
            status=ProcessStatus.REVIEW,
            metadata_json={
                "stage1_last_auto_fix": {
                    "summary": "Se priorizó Excel y se pasó PDF a soporte.",
                    "used_llm": True,
                    "provider_name": "openai_compatible",
                    "model_name": "deepseek-chat",
                    "actions_applied": [{"action_type": "set_document_priority"}],
                    "before_metrics": {"raw_items": 1},
                    "after_metrics": {"raw_items": 6},
                    "before_score": 44,
                    "after_score": 92,
                    "stage_status_after": "ready",
                    "blockers_after": [],
                }
            },
        )
        session.add(process)
        session.flush()

        detail = build_process_detail(process, [], [])

        assert detail.stage1_last_auto_fix is not None
        assert detail.stage1_last_auto_fix.used_llm is True
        assert detail.stage1_last_auto_fix.after_score == 92


def test_process_ai_chat_falls_back_with_limits_when_llm_is_not_configured() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso chat local", status=ProcessStatus.INGESTED, metadata_json={})
        session.add(process)
        session.flush()

        response = ask_process_ai(session, process.id, "Corrige la extracción y vuelve a procesar este expediente.")

        assert response.used_llm is False
        assert response.execution_mode == "local_fallback"
        assert response.can_execute_requested_action is False
        assert response.available_actions
        assert response.system_limits
        assert response.next_step is not None
