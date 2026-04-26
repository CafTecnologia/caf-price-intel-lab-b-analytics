from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from procurement_core.db.base import Base
from procurement_core.models.enums import DocumentKind, ExtractionMethod, FileType, ProcessStatus
from procurement_core.models.orm import ExtractedItemNormalized, ExtractedItemRaw, ProcessDocument, ProcurementProcess
from procurement_core.services.summary_review import SummaryReviewService


def test_summary_review_excludes_non_numbered_pdf_fragments_when_excel_anchor_exists() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso review", status=ProcessStatus.ANALYZED, metadata_json={})
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

        anchors: list[ExtractedItemNormalized] = []
        for item_number in range(1, 6):
            raw = ExtractedItemRaw(
                process_id=process.id,
                document_id=excel_doc.id,
                file_name=excel_doc.file_name,
                file_hash=excel_doc.file_hash,
                raw_description=f"Item estructurado {item_number}",
                raw_quantity="24",
                raw_unit="Unidad",
                raw_unit_price="1000",
                raw_total="24000",
                extraction_method=ExtractionMethod.EXCEL_TABLE,
                extraction_confidence=Decimal("0.99"),
                status="primary",
                evidence_json={"item_number": str(item_number)},
            )
            session.add(raw)
            session.flush()
            normalized = ExtractedItemNormalized(
                raw_item_id=raw.id,
                normalized_description=raw.raw_description,
                quantity_num=Decimal("24"),
                unit_normalized="unidad",
                unit_price_cop=Decimal("1000"),
                total_cop=Decimal("24000"),
                lot_normalized=None,
                canonical_item_key=f"item:{item_number}|lot:-",
                metadata_json={"item_number": str(item_number), "item_number_normalized": str(item_number), "source_role": "primary"},
            )
            session.add(normalized)
            anchors.append(normalized)

        noisy_raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=pdf_doc.id,
            file_name=pdf_doc.file_name,
            file_hash=pdf_doc.file_hash,
            raw_description="Es la obtención 100% de la molienda de la cáscara del trigo blanco en particulas finas.",
            raw_quantity=None,
            raw_unit="Es la obtención 100% de la molienda de la cáscara del trigo blanco en particulas finas.",
            raw_unit_price=None,
            raw_total="Es la obtención 100% de la molienda de la cáscara del trigo blanco en particulas finas.",
            extraction_method=ExtractionMethod.PDF_TABLE,
            extraction_confidence=Decimal("0.82"),
            status="primary",
            evidence_json={},
        )
        session.add(noisy_raw)
        session.flush()
        noisy_normalized = ExtractedItemNormalized(
            raw_item_id=noisy_raw.id,
            normalized_description=noisy_raw.raw_description,
            quantity_num=None,
            unit_normalized=None,
            unit_price_cop=None,
            total_cop=None,
            lot_normalized=None,
            canonical_item_key="desc:noisy",
            metadata_json={"source_role": "primary"},
        )
        session.add(noisy_normalized)
        session.commit()

        service = SummaryReviewService()
        decisions, summary = service.review(anchors + [noisy_normalized])

        decision = next(item for item in decisions if item.normalized_item_id == noisy_normalized.id)
        assert decision.include_in_summary is False
        assert "unit_repeats_description" in decision.flags
        assert "total_repeats_description" in decision.flags
        assert summary["excluded_items"] == 1


def test_summary_review_keeps_priced_catalog_rows_without_numeric_quantity() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso catalogo", status=ProcessStatus.ANALYZED, metadata_json={})
        session.add(process)
        session.flush()

        pdf_doc = ProcessDocument(
            process_id=process.id,
            file_name="estudio.pdf",
            file_hash="hash-pdf",
            file_type=FileType.PDF,
            document_kind=DocumentKind.PRIOR_STUDY,
            storage_path="pdf",
            metadata_json={},
        )
        session.add(pdf_doc)
        session.flush()

        raw = ExtractedItemRaw(
            process_id=process.id,
            document_id=pdf_doc.id,
            file_name=pdf_doc.file_name,
            file_hash=pdf_doc.file_hash,
            raw_description="Candado de hierro 38 mm niquelado",
            raw_quantity="A pedido",
            raw_unit=None,
            raw_unit_price="$9,622",
            raw_total=None,
            extraction_method=ExtractionMethod.PDF_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="primary",
            evidence_json={"item_number": "1"},
        )
        session.add(raw)
        session.flush()

        normalized = ExtractedItemNormalized(
            raw_item_id=raw.id,
            normalized_description=raw.raw_description,
            quantity_num=None,
            unit_normalized=None,
            unit_price_cop=Decimal("9622"),
            total_cop=None,
            lot_normalized=None,
            canonical_item_key="item:1|lot:-",
            metadata_json={"item_number": "1", "item_number_normalized": "1", "source_role": "primary"},
        )
        session.add(normalized)
        session.commit()

        decisions, summary = SummaryReviewService().review([normalized])

        decision = decisions[0]
        assert decision.include_in_summary is True
        assert decision.flags == []
        assert summary["excluded_items"] == 0
