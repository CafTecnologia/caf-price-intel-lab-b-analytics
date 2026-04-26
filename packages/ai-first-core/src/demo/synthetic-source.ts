import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

export function buildSyntheticSourceSegments(documentId: string): SourceSegment[] {
  return [
    {
      segment_id: `${documentId}:seg-1`,
      document_id: documentId,
      segment_index: 0,
      unit_type: "page_block",
      locator: {
        page: 1,
        sheet: null,
        table: null,
        row_start: null,
        row_end: null,
        cell_range: null,
        paragraph_index: null,
        char_start: null,
        char_end: null,
        note: "Cover and introduction",
      },
      raw_text:
        "ESTUDIO DE MERCADO\nObjeto contractual: suministro de equipos.\nA continuacion se presenta la relacion oficial de items y precios de referencia.",
      normalized_text: null,
      checksum_sha256: `${documentId}-checksum-seg-1`,
      metadata: {},
    },
    {
      segment_id: `${documentId}:seg-2`,
      document_id: documentId,
      segment_index: 1,
      unit_type: "table_block",
      locator: {
        page: 2,
        sheet: null,
        table: "tabla-1",
        row_start: 1,
        row_end: 4,
        cell_range: null,
        paragraph_index: null,
        char_start: null,
        char_end: null,
        note: "Official item block",
      },
      raw_text:
        "ITEM | DESCRIPCION | CANTIDAD | UNIDAD | PRECIO UNITARIO | PRECIO TOTAL | MONEDA\n1 | Portatil empresarial 16GB RAM SSD 512GB | 10 | UND | 3500000 | 35000000 | COP\n2 | Monitor 24 pulgadas panel IPS | 10 | UND | 850000 | 8500000 | COP",
      normalized_text: null,
      checksum_sha256: `${documentId}-checksum-seg-2`,
      metadata: {},
    },
    {
      segment_id: `${documentId}:seg-3`,
      document_id: documentId,
      segment_index: 2,
      unit_type: "table_block",
      locator: {
        page: 3,
        sheet: null,
        table: "tabla-2",
        row_start: 5,
        row_end: 8,
        cell_range: null,
        paragraph_index: null,
        char_start: null,
        char_end: null,
        note: "Official item continuation",
      },
      raw_text:
        "3 | Teclado inalambrico ergonomico | 10 | UND | 120000 | 1200000 | COP\n4 | Mouse inalambrico optico | 10 | UND | 90000 | 900000 | COP\nNota: precios de referencia obtenidos de estudio sectorial.",
      normalized_text: null,
      checksum_sha256: `${documentId}-checksum-seg-3`,
      metadata: {},
    },
  ];
}
