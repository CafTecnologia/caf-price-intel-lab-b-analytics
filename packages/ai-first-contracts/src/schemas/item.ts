import { z } from "zod";

import { EXTRACTION_MODES } from "../enums";
import { SourceLocatorSchema, SourceRangeSchema } from "./source";

export const ItemSourceLocationSchema = z
  .object({
    primary_locator: SourceLocatorSchema,
    source_range: SourceRangeSchema,
    segment_ids: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const NormalizedItemSchema = z
  .object({
    item_uid: z.string().trim().min(1),
    numero_item: z.string().trim().min(1).nullable().default(null),
    nombre_o_descripcion: z.string().trim().min(1).nullable().default(null),
    ficha_tecnica: z.string().trim().min(1).nullable().default(null),
    cantidad: z.number().finite().nullable().default(null),
    unidad_medida: z.string().trim().min(1).nullable().default(null),
    precio_referencia_unit: z.number().finite().nullable().default(null),
    precio_referencia_total: z.number().finite().nullable().default(null),
    moneda: z.string().trim().min(1).nullable().default(null),
    raw_text_evidence: z.string().trim().min(1).max(2_000).nullable().default(null),
    source_location: ItemSourceLocationSchema,
    extraction_mode: z.enum(EXTRACTION_MODES),
    warnings: z.array(z.string().trim().min(1)).default([]),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type ItemSourceLocation = z.infer<typeof ItemSourceLocationSchema>;
export type NormalizedItem = z.infer<typeof NormalizedItemSchema>;
