from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from procurement_core.db.base import Base
from procurement_core.models.enums import DocumentKind, ExtractionMethod, FileType, ProcessStatus
from procurement_core.models.orm import ExtractedItemNormalized, ExtractedItemRaw, ProcessDocument, ProcurementProcess
from procurement_core.pipelines.analysis import ProcessAnalysisPipeline


def test_same_description_different_item_numbers_do_not_collapse() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso dedupe", status=ProcessStatus.INGESTED, metadata_json={})
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
            document_kind=DocumentKind.PRICE_LIST,
            storage_path="pdf",
            metadata_json={},
        )
        session.add_all([excel_doc, pdf_doc])
        session.flush()

        raw_1 = ExtractedItemRaw(
            process_id=process.id,
            document_id=excel_doc.id,
            file_name=excel_doc.file_name,
            file_hash=excel_doc.file_hash,
            lot="Lote 1",
            raw_description="Guante de nitrilo talla M",
            raw_quantity="10",
            raw_unit="Caja",
            raw_unit_price="10000",
            raw_total="100000",
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="extracted",
            evidence_json={"item_number": "1"},
        )
        raw_2 = ExtractedItemRaw(
            process_id=process.id,
            document_id=pdf_doc.id,
            file_name=pdf_doc.file_name,
            file_hash=pdf_doc.file_hash,
            lot="Lote 1",
            raw_description="Guante de nitrilo talla M",
            raw_quantity="10",
            raw_unit="Caja",
            raw_unit_price="10000",
            raw_total="100000",
            raw_currency="COP",
            extraction_method=ExtractionMethod.PDF_TABLE,
            extraction_confidence=Decimal("0.90"),
            status="extracted",
            evidence_json={"item_number": "1"},
        )
        raw_3 = ExtractedItemRaw(
            process_id=process.id,
            document_id=excel_doc.id,
            file_name=excel_doc.file_name,
            file_hash=excel_doc.file_hash,
            lot="Lote 1",
            raw_description="Guante de nitrilo talla M",
            raw_quantity="10",
            raw_unit="Caja",
            raw_unit_price="10500",
            raw_total="105000",
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="extracted",
            evidence_json={"item_number": "2"},
        )
        session.add_all([raw_1, raw_2, raw_3])
        session.flush()

        session.add_all(
            [
                ExtractedItemNormalized(
                    raw_item_id=raw_1.id,
                    normalized_description=raw_1.raw_description,
                    quantity_num=Decimal("10"),
                    unit_normalized="caja",
                    unit_price_cop=Decimal("10000"),
                    total_cop=Decimal("100000"),
                    lot_normalized="lote 1",
                    canonical_item_key="item:1|lot:1",
                    metadata_json={"item_number_normalized": "1"},
                ),
                ExtractedItemNormalized(
                    raw_item_id=raw_2.id,
                    normalized_description=raw_2.raw_description,
                    quantity_num=Decimal("10"),
                    unit_normalized="caja",
                    unit_price_cop=Decimal("10000"),
                    total_cop=Decimal("100000"),
                    lot_normalized="lote 1",
                    canonical_item_key="item:1|lot:1",
                    metadata_json={"item_number_normalized": "1"},
                ),
                ExtractedItemNormalized(
                    raw_item_id=raw_3.id,
                    normalized_description=raw_3.raw_description,
                    quantity_num=Decimal("10"),
                    unit_normalized="caja",
                    unit_price_cop=Decimal("10500"),
                    total_cop=Decimal("105000"),
                    lot_normalized="lote 1",
                    canonical_item_key="item:2|lot:1",
                    metadata_json={"item_number_normalized": "2"},
                ),
            ]
        )
        session.commit()

        pipeline = ProcessAnalysisPipeline(session)
        normalized_items = session.execute(select(ExtractedItemNormalized)).scalars().all()
        primary_ids = pipeline._mark_primary_sources(normalized_items)

        assert len(primary_ids) == 2

        statuses = {raw.id: raw.status for raw in session.execute(select(ExtractedItemRaw)).scalars().all()}
        assert statuses[raw_1.id] == "primary"
        assert statuses[raw_2.id] == "corroborative"
        assert statuses[raw_3.id] == "primary"
