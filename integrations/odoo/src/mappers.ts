import type { DocumentResult } from "../../../packages/ai-first-contracts/src/schemas/document";
import type { NormalizedItem } from "../../../packages/ai-first-contracts/src/schemas/item";

import type { OdooImportPreview, OdooLinePreview } from "./dtos";

function summarizeSourceLocation(item: NormalizedItem): string {
  const locator = item.source_location.primary_locator;
  const parts = [
    locator.page !== null ? `page ${locator.page}` : null,
    locator.sheet ? `sheet ${locator.sheet}` : null,
    locator.table ? `table ${locator.table}` : null,
    locator.cell_range ? `range ${locator.cell_range}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : item.source_location.source_range.label;
}

function mapLine(item: NormalizedItem): OdooLinePreview {
  return {
    external_item_uid: item.item_uid,
    numero_item: item.numero_item,
    nombre_o_descripcion: item.nombre_o_descripcion,
    ficha_tecnica: item.ficha_tecnica,
    cantidad: item.cantidad,
    unidad_medida: item.unidad_medida,
    precio_referencia_unit: item.precio_referencia_unit,
    precio_referencia_total: item.precio_referencia_total,
    moneda: item.moneda,
    raw_text_evidence: item.raw_text_evidence,
    source_location_label: summarizeSourceLocation(item),
    extraction_mode: item.extraction_mode,
    confidence: item.confidence,
    warnings: item.warnings,
  };
}

export function mapDocumentToOdooPreview(document: DocumentResult): OdooImportPreview {
  const providerSummary = Object.fromEntries(
    Object.entries(document.provider_config_used).map(([task, config]) => [task, `${config.provider}:${config.model}`]),
  );

  const validationWarnings = document.global_validation?.warnings ?? [];

  return {
    header: {
      external_document_id: document.document_id,
      source_file_name: document.file_name,
      source_file_type: document.file_type,
      processing_status: document.processing_status,
      final_confidence_score: document.final_confidence_score,
      total_items: document.items.length,
      global_warnings: document.global_warnings,
      provider_summary: providerSummary,
    },
    lines: document.items.map(mapLine),
    attachments: [],
    audit_summary: {
      detection_warnings: document.detection_summary.warnings,
      validation_warnings: validationWarnings,
    },
  };
}
