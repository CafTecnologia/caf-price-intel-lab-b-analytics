from pathlib import Path

from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from procurement_core.benchmark.service import BenchmarkService
from procurement_core.db.base import Base
from procurement_core.models.orm import ExtractedItemRaw, FinancialAssessment, ProcessDocument, ProcurementProcess
from procurement_core.pipelines.analysis import ProcessAnalysisPipeline
from procurement_core.schemas.process import ProcessCreate
from procurement_core.storage.files import LocalFileStorage
from procurement_api.services import create_process


def test_pipeline_generates_raw_items_and_assessment(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    storage = LocalFileStorage(root=tmp_path / "storage")
    xlsx_path = tmp_path / "presupuesto.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Descripción", "Cantidad", "Unidad", "Valor Unitario", "Valor Total", "Lote"])
    sheet.append(["Guantes de nitrilo talla M caja x 100", 10, "caja", 32000, 320000, "Lote 1"])
    workbook.save(xlsx_path)

    with Session(engine) as session:
        process = create_process(session, ProcessCreate(name="Proceso prueba"))
        ingested = storage.save_process_file(process.id, xlsx_path.name, xlsx_path.read_bytes())
        session.add(
            ProcessDocument(
                process_id=process.id,
                file_name=ingested.file_name,
                file_hash=ingested.file_hash,
                mime_type=ingested.mime_type,
                file_type=ingested.file_type,
                storage_path=str(ingested.storage_path),
                metadata_json=ingested.metadata,
            )
        )
        session.commit()

        seed_path = Path(__file__).resolve().parents[2] / "demo" / "sample_process" / "benchmark_seed.json"
        result = ProcessAnalysisPipeline(session, benchmark_service=BenchmarkService(seed_path=seed_path)).analyze_process(process.id)

        assert result["raw_items"] == 1
        assert session.scalar(select(ProcurementProcess).where(ProcurementProcess.id == process.id)) is not None
        assert session.scalar(select(ExtractedItemRaw)) is not None
        assert session.scalar(select(FinancialAssessment)) is not None
