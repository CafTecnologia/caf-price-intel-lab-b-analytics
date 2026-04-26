from pathlib import Path

from procurement_core.extractors.pdf_native import PDFNativeExtractor
from procurement_core.schemas.extraction import DocumentProfile


class _FakePage:
    def extract_text(self) -> str:
        return ""


class _FakeReader:
    def __init__(self, _path: str) -> None:
        self.pages = [_FakePage()]


class _FakeRouter:
    def extract(self, _file_path: Path):
        return (
            [
                [
                    ["Nº", "Descripción del ítem", "Cantidad", "Vr. Unitario"],
                    ["1", "Candado de hierro 38 mm niquelado", "A pedido", "$9,622"],
                    ["2", "Llave terminal bronce 1/2", "A pedido", "$ 37,525"],
                ],
                [
                    ["3", "Cinta teflón industrial x 15 mts", "A pedido", "$4,330"],
                    ["4", "Extensión eléctrica 5 mts naranja", "A pedido", "$ 16,838"],
                ],
            ],
            "pdfplumber",
        )


def test_pdf_native_extractor_reuses_previous_header_for_continued_tables(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr("procurement_core.extractors.pdf_native.PdfReader", _FakeReader)

    file_path = tmp_path / "mutata.pdf"
    file_path.write_bytes(b"%PDF-1.4\n")
    profile = DocumentProfile(
        file_name="mutata ESTUDIO PREVIO-Copiar.pdf",
        file_type="pdf",
        mime_type="application/pdf",
        route="pdf_native",
        detected_by="content",
        is_pdf_native=True,
    )

    batch = PDFNativeExtractor(table_router=_FakeRouter()).extract(file_path, profile)

    assert len(batch.items) == 4
    assert [item.raw_item_number for item in batch.items] == ["1", "2", "3", "4"]
    assert batch.items[0].raw_description == "Candado de hierro 38 mm niquelado"
    assert batch.items[2].raw_description == "Cinta teflón industrial x 15 mts"
    assert batch.items[3].raw_unit_price == "$ 16,838"
