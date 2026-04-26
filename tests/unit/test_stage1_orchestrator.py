from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from procurement_api.presenters import build_process_detail
from procurement_core.db.base import Base
from procurement_core.models.enums import DocumentKind, ExtractionMethod, FileType, ProcessStatus
from procurement_core.models.orm import ExtractedItemNormalized, ExtractedItemRaw, ProcessDocument, ProcurementProcess
from procurement_core.services.stage1_orchestrator import Stage1RedundantVerdictService


def test_redundant_verdict_blocks_stage_1_when_financial_fields_are_missing() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso gate", status=ProcessStatus.REVIEW, metadata_json={})
        session.add(process)
        session.flush()

        document = ProcessDocument(
            process_id=process.id,
            file_name="oferta.xlsx",
            file_hash="hash-excel",
            file_type=FileType.EXCEL,
            document_kind=DocumentKind.PRICE_LIST,
            storage_path="excel",
            metadata_json={},
        )
        session.add(document)
        session.flush()

        raw_item = ExtractedItemRaw(
            process_id=process.id,
            document_id=document.id,
            file_name=document.file_name,
            file_hash=document.file_hash,
            sheet_name="Hoja 1",
            raw_description="Equipo especializado",
            raw_quantity="1",
            raw_unit="Unidad",
            raw_unit_price=None,
            raw_total=None,
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.98"),
            status="primary",
            evidence_json={"item_number": "1"},
        )
        session.add(raw_item)
        session.flush()
        session.add(
            ExtractedItemNormalized(
                raw_item_id=raw_item.id,
                normalized_description=raw_item.raw_description,
                quantity_num=Decimal("1"),
                unit_normalized="unidad",
                unit_price_cop=None,
                total_cop=None,
                lot_normalized=None,
                canonical_item_key="item:1|lot:-",
                metadata_json={"item_number": "1", "item_number_normalized": "1", "source_role": "primary"},
            )
        )
        session.commit()

        detail = build_process_detail(process, [document], [])
        verdict = Stage1RedundantVerdictService().evaluate(detail)

        assert verdict["final_decision"] == "review_required"
        assert verdict["proceed_allowed"] is False
        assert verdict["rule_decision"] == "review_required"
        assert verdict["rule_reasons"]


def test_presenter_exposes_stage1_redundant_gate_in_metrics() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(
            name="Proceso gate presenter",
            status=ProcessStatus.REVIEW,
            metadata_json={
                "stage1_redundant_verdict": {
                    "final_decision": "review_required",
                    "rule_decision": "review_required",
                    "llm_decision": "review_required",
                    "iterations_run": 2,
                    "reasons": ["La compuerta redundante aún no aprueba la etapa 1."],
                }
            },
        )
        session.add(process)
        session.flush()

        detail = build_process_detail(process, [], [])

        stage_1 = detail.stage_summaries[0]
        assert stage_1.metrics["final_gate"] == "review_required"
        assert stage_1.metrics["gate_rule"] == "review_required"
        assert stage_1.metrics["gate_ai"] == "review_required"
        assert stage_1.metrics["gate_iterations"] == 2
        assert "La compuerta redundante aún no aprueba la etapa 1." in stage_1.blocking_reasons
