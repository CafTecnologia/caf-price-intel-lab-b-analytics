import { PipelineFailure, type AiStage } from "@/lib/ai-failures";

const STAGE1_ITEM_FIELDS = [
  "Consecutivo interno",
  "Lote",
  "No. item",
  "Nombre o descripción",
  "Detalles o ficha técnica",
  "Und de medida",
  "Cant",
  "Precio techo encontrado"
];

const STAGE2_ITEM_FIELDS = [
  ...STAGE1_ITEM_FIELDS,
  "Tipo de ficha",
  "Unidad técnica de referencia",
  "Nota técnica para cotización",
  "Confianza"
];

const STAGE3_ITEM_FIELDS = [
  ...STAGE2_ITEM_FIELDS,
  "Estado de cotización",
  "Vista rápida de cotización",
  "Cotizaciones encontradas",
  "Auditoría de búsqueda",
  "Resumen de cotización",
  "Confianza cotización"
];

export function validateStageResult(stage: Exclude<AiStage, "pipeline">, result: unknown) {
  if (!isRecord(result)) {
    throw new PipelineFailure({
      code: "AI_DATA_INCOMPLETE",
      stage,
      technicalMessage: "La respuesta parseada no es un objeto JSON.",
      result
    });
  }

  if (!isRecord(result.metadata)) {
    throw new PipelineFailure({
      code: "AI_DATA_INCOMPLETE",
      stage,
      technicalMessage: "Falta metadata en la respuesta de la IA.",
      result
    });
  }

  if (!Array.isArray(result.items)) {
    throw new PipelineFailure({
      code: "AI_DATA_INCOMPLETE",
      stage,
      technicalMessage: "Falta items[] en la respuesta de la IA.",
      result
    });
  }

  if (result.items.length === 0) {
    throw new PipelineFailure({
      code: "AI_DATA_EMPTY",
      stage,
      technicalMessage: "La IA devolvio items[] vacio.",
      result
    });
  }

  const requiredFields =
    stage === "stage1"
      ? STAGE1_ITEM_FIELDS
      : stage === "stage2"
        ? STAGE2_ITEM_FIELDS
        : STAGE3_ITEM_FIELDS;
  const missingFields = collectMissingFields(result.items, requiredFields);

  if ((stage === "stage2" || stage === "stage3") && !isRecord(result.control_calidad)) {
    missingFields.push({
      itemIndex: null,
      fields: ["control_calidad"]
    });
  }

  if (missingFields.length) {
    throw new PipelineFailure({
      code: "AI_DATA_INCOMPLETE",
      stage,
      technicalMessage: "La IA devolvio JSON, pero faltan campos obligatorios.",
      details: { missingFields },
      result
    });
  }
}

type MissingFieldGroup = {
  itemIndex: number | null;
  fields: string[];
};

function collectMissingFields(items: unknown[], requiredFields: string[]): MissingFieldGroup[] {
  return items.flatMap((item, index) => {
    if (!isRecord(item)) {
      return [{ itemIndex: index, fields: ["<item_object>"] }];
    }

    const fields = requiredFields.filter((field) => !(field in item));

    if (!fields.length) {
      return [];
    }

    return [{ itemIndex: index, fields }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
