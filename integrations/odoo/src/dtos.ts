import { z } from "zod";

export const OdooAttachmentPreviewSchema = z
  .object({
    file_name: z.string().trim().min(1),
    mime_type: z.string().trim().min(1),
    storage_key: z.string().trim().min(1),
  })
  .strict();

export const OdooHeaderPreviewSchema = z
  .object({
    external_document_id: z.string().trim().min(1),
    source_file_name: z.string().trim().min(1),
    source_file_type: z.string().trim().min(1),
    processing_status: z.string().trim().min(1),
    final_confidence_score: z.number().min(0).max(1).nullable().default(null),
    total_items: z.number().int().min(0),
    global_warnings: z.array(z.string().trim().min(1)).default([]),
    provider_summary: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const OdooLinePreviewSchema = z
  .object({
    external_item_uid: z.string().trim().min(1),
    numero_item: z.string().trim().min(1).nullable().default(null),
    nombre_o_descripcion: z.string().trim().min(1).nullable().default(null),
    ficha_tecnica: z.string().trim().min(1).nullable().default(null),
    cantidad: z.number().finite().nullable().default(null),
    unidad_medida: z.string().trim().min(1).nullable().default(null),
    precio_referencia_unit: z.number().finite().nullable().default(null),
    precio_referencia_total: z.number().finite().nullable().default(null),
    moneda: z.string().trim().min(1).nullable().default(null),
    raw_text_evidence: z.string().trim().min(1).nullable().default(null),
    source_location_label: z.string().trim().min(1),
    extraction_mode: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const OdooImportPreviewSchema = z
  .object({
    header: OdooHeaderPreviewSchema,
    lines: z.array(OdooLinePreviewSchema),
    attachments: z.array(OdooAttachmentPreviewSchema).default([]),
    audit_summary: z.object({
      detection_warnings: z.array(z.string().trim().min(1)).default([]),
      validation_warnings: z.array(z.string().trim().min(1)).default([]),
    }),
  })
  .strict();

export type OdooAttachmentPreview = z.infer<typeof OdooAttachmentPreviewSchema>;
export type OdooHeaderPreview = z.infer<typeof OdooHeaderPreviewSchema>;
export type OdooLinePreview = z.infer<typeof OdooLinePreviewSchema>;
export type OdooImportPreview = z.infer<typeof OdooImportPreviewSchema>;
