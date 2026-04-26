from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from procurement_core.db.base import Base
from procurement_core.models.enums import DocumentKind, ExtractionMethod, FileType, ProcessStatus
from procurement_core.models.orm import ExtractedItemNormalized, ExtractedItemRaw, ProcessDocument, ProcurementProcess
from procurement_core.validation.engine import ValidationEngine


def test_validation_skips_missing_price_for_corroborative_rows_when_primary_is_complete() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso validacion", status=ProcessStatus.REVIEW, metadata_json={})
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
            file_name="soporte.pdf",
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
            raw_description="Breaker 20A",
            raw_quantity="20",
            raw_unit="Unidad",
            raw_unit_price="16660",
            raw_total="396508",
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
            raw_description="Breaker 20A",
            raw_quantity="25",
            raw_unit="Unidad",
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

        primary_normalized = ExtractedItemNormalized(
            raw_item_id=primary_raw.id,
            normalized_description=primary_raw.raw_description,
            quantity_num=Decimal("20"),
            unit_normalized="unidad",
            unit_price_cop=Decimal("16660"),
            total_cop=Decimal("396508"),
            lot_normalized=None,
            canonical_item_key="item:1|lot:-",
            metadata_json={"item_number": "1", "item_number_normalized": "1"},
        )
        corroborative_normalized = ExtractedItemNormalized(
            raw_item_id=corroborative_raw.id,
            normalized_description=corroborative_raw.raw_description,
            quantity_num=Decimal("25"),
            unit_normalized="unidad",
            unit_price_cop=None,
            total_cop=None,
            lot_normalized=None,
            canonical_item_key="item:1|lot:-",
            metadata_json={"item_number": "1", "item_number_normalized": "1"},
        )

        session.add_all([primary_normalized, corroborative_normalized])
        session.commit()

        issues_by_raw_id = ValidationEngine().evaluate_process(
            [
                (primary_raw, primary_normalized),
                (corroborative_raw, corroborative_normalized),
            ]
        )

        corroborative_titles = [issue["title"] for issue in issues_by_raw_id[corroborative_raw.id]]
        assert "Campos requeridos faltantes" not in corroborative_titles


def test_validation_skips_arithmetic_issue_when_total_matches_unit_price_plus_tax() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso IVA", status=ProcessStatus.REVIEW, metadata_json={})
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
            raw_description="Adaptador terminal",
            raw_quantity="10",
            raw_unit="Unidad",
            raw_unit_price="680",
            raw_total="8092",
            raw_tax_note="0.19",
            raw_currency="COP",
            extraction_method=ExtractionMethod.EXCEL_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="primary",
            evidence_json={"item_number": "1"},
        )
        session.add(raw_item)
        session.flush()

        normalized_item = ExtractedItemNormalized(
            raw_item_id=raw_item.id,
            normalized_description=raw_item.raw_description,
            quantity_num=Decimal("10"),
            unit_normalized="unidad",
            unit_price_cop=Decimal("680"),
            total_cop=Decimal("8092"),
            lot_normalized=None,
            canonical_item_key="item:1|lot:-",
            metadata_json={"item_number": "1", "item_number_normalized": "1"},
        )
        session.add(normalized_item)
        session.commit()

        issues_by_raw_id = ValidationEngine().evaluate_process([(raw_item, normalized_item)])

        issue_titles = [issue["title"] for issue in issues_by_raw_id[raw_item.id]]
        assert "Inconsistencia aritmetica" not in issue_titles


def test_validation_skips_missing_fields_for_priced_catalog_row() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        process = ProcurementProcess(name="Proceso catalogo", status=ProcessStatus.REVIEW, metadata_json={})
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

        raw_item = ExtractedItemRaw(
            process_id=process.id,
            document_id=pdf_doc.id,
            file_name=pdf_doc.file_name,
            file_hash=pdf_doc.file_hash,
            raw_description="Candado de hierro 38 mm niquelado",
            raw_quantity="A pedido",
            raw_unit=None,
            raw_unit_price="$9,622",
            raw_total=None,
            raw_currency="COP",
            extraction_method=ExtractionMethod.PDF_TABLE,
            extraction_confidence=Decimal("0.95"),
            status="primary",
            evidence_json={"item_number": "1"},
        )
        session.add(raw_item)
        session.flush()

        normalized_item = ExtractedItemNormalized(
            raw_item_id=raw_item.id,
            normalized_description=raw_item.raw_description,
            quantity_num=None,
            unit_normalized=None,
            unit_price_cop=Decimal("9622"),
            total_cop=None,
            lot_normalized=None,
            canonical_item_key="item:1|lot:-",
            metadata_json={"item_number": "1", "item_number_normalized": "1"},
        )
        session.add(normalized_item)
        session.commit()

        issues_by_raw_id = ValidationEngine().evaluate_process([(raw_item, normalized_item)])

        issue_titles = [issue["title"] for issue in issues_by_raw_id[raw_item.id]]
        assert "Campos requeridos faltantes" not in issue_titles
        assert "Unidad ambigua o vacia" not in issue_titles
