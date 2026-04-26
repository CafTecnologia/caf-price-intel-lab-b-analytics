import type { AiProvider } from "../../../ai-first-contracts/src/enums";
import type { ProviderConfigByTask } from "../../../ai-first-contracts/src/schemas/provider-config";
import type { SourceSegment } from "../../../ai-first-contracts/src/schemas/source";

export interface SyntheticRow {
  numero_item: string;
  nombre_o_descripcion: string;
  cantidad: number;
  unidad_medida: string;
  precio_referencia_unit: number;
  precio_referencia_total: number;
  moneda: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function buildChecksum(documentId: string, segmentIndex: number): string {
  return `${documentId}-audit-checksum-segment-${segmentIndex + 1}`;
}

export function resolveAuditModel(provider: AiProvider): string {
  switch (provider) {
    case "gemini":
      return "gemini-2.5-flash";
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "deepseek":
      return "deepseek-chat";
    case "openai":
    default:
      return "gpt-4.1-mini";
  }
}

export function buildAuditProviderConfig(
  provider: AiProvider = "openai",
  model: string = resolveAuditModel(provider),
): ProviderConfigByTask {
  const shared = {
    provider,
    model,
    temperature: 0,
    timeout_ms: 60_000,
    max_retries: 1,
    max_input_tokens: null,
    max_output_tokens: 4_000,
    top_p: null,
    seed: null,
    prompt_version: "2026-04-21.1",
    extra: {},
  } as const;

  return {
    detectOfficialBlock: { ...shared },
    extractItemsBatch: { ...shared },
    validateBatch: { ...shared },
    validateGlobal: { ...shared },
  };
}

export function buildSyntheticRows(count: number, options?: { descriptionPrefix?: string; quantity?: number }): SyntheticRow[] {
  const descriptionPrefix = options?.descriptionPrefix ?? "Item sintetico auditado";
  const quantity = options?.quantity ?? 10;

  return Array.from({ length: count }, (_, index) => {
    const itemNumber = index + 1;
    const unitPrice = 100_000 + itemNumber * 7_500;

    return {
      numero_item: String(itemNumber),
      nombre_o_descripcion: `${descriptionPrefix} ${itemNumber}`,
      cantidad: quantity,
      unidad_medida: "UND",
      precio_referencia_unit: unitPrice,
      precio_referencia_total: unitPrice * quantity,
      moneda: "COP",
    };
  });
}

export function cloneSyntheticRow(row: SyntheticRow, overrides?: Partial<SyntheticRow>): SyntheticRow {
  return {
    ...row,
    ...overrides,
  };
}

function formatRow(row: SyntheticRow): string {
  return [
    row.numero_item,
    row.nombre_o_descripcion,
    String(row.cantidad),
    row.unidad_medida,
    String(row.precio_referencia_unit),
    String(row.precio_referencia_total),
    row.moneda,
  ].join(" | ");
}

export function buildSyntheticDocumentSegments(args: {
  documentId: string;
  rows: SyntheticRow[];
  rowsPerSegment?: number;
  includeCover?: boolean;
  finalNote?: string | null;
}): SourceSegment[] {
  const rowsPerSegment = Math.max(1, args.rowsPerSegment ?? 10);
  const segments: SourceSegment[] = [];
  let segmentIndex = 0;
  let rowCursor = 1;

  if (args.includeCover ?? true) {
    segments.push({
      segment_id: `${args.documentId}:seg-${segmentIndex + 1}`,
      document_id: args.documentId,
      segment_index: segmentIndex,
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
        note: "Cover and executive summary",
      },
      raw_text:
        "ESTUDIO DE MERCADO\nDocumento oficial de referencia.\nLa relacion consolidada de items y precios de referencia se presenta en las tablas siguientes.",
      normalized_text: null,
      checksum_sha256: buildChecksum(args.documentId, segmentIndex),
      metadata: {},
    });
    segmentIndex += 1;
  }

  const rowGroups = chunk(args.rows, rowsPerSegment);

  for (const [groupIndex, rowGroup] of rowGroups.entries()) {
    const isLastGroup = groupIndex === rowGroups.length - 1;
    const rawLines = [
      "ITEM | DESCRIPCION | CANTIDAD | UNIDAD | PRECIO UNITARIO | PRECIO TOTAL | MONEDA",
      ...rowGroup.map(formatRow),
    ];

    if (isLastGroup && args.finalNote) {
      rawLines.push(args.finalNote);
    }

    segments.push({
      segment_id: `${args.documentId}:seg-${segmentIndex + 1}`,
      document_id: args.documentId,
      segment_index: segmentIndex,
      unit_type: "table_block",
      locator: {
        page: segmentIndex + 1,
        sheet: null,
        table: `tabla-${groupIndex + 1}`,
        row_start: rowCursor,
        row_end: rowCursor + rowGroup.length,
        cell_range: null,
        paragraph_index: null,
        char_start: null,
        char_end: null,
        note: groupIndex === 0 ? "Official item block" : "Official item continuation",
      },
      raw_text: rawLines.join("\n"),
      normalized_text: null,
      checksum_sha256: buildChecksum(args.documentId, segmentIndex),
      metadata: {},
    });

    rowCursor += rowGroup.length + 1;
    segmentIndex += 1;
  }

  return segments;
}
