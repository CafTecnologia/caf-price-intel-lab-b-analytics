import { classifyProviderError } from "@/lib/ai-error-catalog";

export type AiStage = "stage1" | "stage2" | "stage3" | "pipeline";

export type AiFailureCode =
  | "CONFIG_MISSING"
  | "API_KEY_INVALID"
  | "API_CONNECTION_FAILED"
  | "API_PERMISSION_DENIED"
  | "API_MODEL_NOT_FOUND"
  | "API_BILLING_REQUIRED"
  | "API_RATE_LIMITED"
  | "API_REQUEST_TOO_LARGE"
  | "API_REQUEST_REJECTED"
  | "API_PROVIDER_ERROR"
  | "API_PROVIDER_UNAVAILABLE"
  | "API_TIMEOUT"
  | "AI_EMPTY_RESPONSE"
  | "AI_JSON_INVALID"
  | "AI_DATA_EMPTY"
  | "AI_DATA_INCOMPLETE"
  | "AI_UNRELIABLE_PRICING"
  | "FILE_TEXT_EXTRACTION_FAILED"
  | "UNEXPECTED_ERROR";

type AiFailureCategory =
  | "config"
  | "auth"
  | "permission"
  | "model"
  | "quota"
  | "provider"
  | "network"
  | "format"
  | "file"
  | "data"
  | "unknown";

type AiFailureDefinition = {
  title: string;
  userMessage: string;
  userAction: string;
  httpStatus: number;
  category: AiFailureCategory;
  retryable: boolean;
};

export const AI_FAILURES: Record<AiFailureCode, AiFailureDefinition> = {
  CONFIG_MISSING: {
    title: "Configuración incompleta",
    userMessage: "Falta configurar la API key o el modelo del motor IA.",
    userAction: "Ingresa la API key, selecciona un modelo, guarda la configuración y prueba la conexión.",
    httpStatus: 400,
    category: "config",
    retryable: false
  },
  API_KEY_INVALID: {
    title: "API key no válida",
    userMessage: "La API key no fue aceptada por el motor IA.",
    userAction: "Genera una clave nueva, guárdala y vuelve a probar la conexión.",
    httpStatus: 400,
    category: "auth",
    retryable: false
  },
  API_CONNECTION_FAILED: {
    title: "Conexión fallida",
    userMessage: "No se pudo conectar con el motor IA.",
    userAction: "Revisa la conexión a internet y vuelve a intentar. Si la red está bien, espera unos minutos e inténtalo de nuevo.",
    httpStatus: 502,
    category: "network",
    retryable: true
  },
  API_PERMISSION_DENIED: {
    title: "Permiso denegado",
    userMessage: "La API key no tiene permiso para usar el motor IA o este modelo.",
    userAction: "Verifica que la clave pertenezca al proyecto correcto y que tenga acceso al modelo seleccionado.",
    httpStatus: 403,
    category: "permission",
    retryable: false
  },
  API_MODEL_NOT_FOUND: {
    title: "Modelo no disponible",
    userMessage: "El modelo seleccionado no está disponible para esta API key.",
    userAction: "Selecciona otro modelo del motor IA, guarda la configuración y prueba la conexión.",
    httpStatus: 404,
    category: "model",
    retryable: false
  },
  API_BILLING_REQUIRED: {
    title: "Plan o facturación requerida",
    userMessage: "El proyecto no tiene disponible el plan necesario para esta solicitud.",
    userAction: "Revisa facturación o créditos del proveedor, o prueba un modelo disponible para tu plan.",
    httpStatus: 402,
    category: "permission",
    retryable: false
  },
  API_RATE_LIMITED: {
    title: "Límite de uso alcanzado",
    userMessage: "El motor IA rechazó la solicitud por cuota o demasiadas solicitudes.",
    userAction: "Espera un momento y vuelve a intentar la etapa. Si se repite, revisa cuota, créditos o facturación del proveedor.",
    httpStatus: 429,
    category: "quota",
    retryable: true
  },
  API_REQUEST_TOO_LARGE: {
    title: "Archivo o solicitud demasiado grande",
    userMessage: "El motor IA no pudo procesar el contenido por tamaño o límite de contexto.",
    userAction: "Prueba con un archivo más corto o divide el documento en partes.",
    httpStatus: 413,
    category: "format",
    retryable: false
  },
  API_REQUEST_REJECTED: {
    title: "Solicitud rechazada",
    userMessage: "El motor IA rechazó la solicitud antes de responder.",
    userAction: "Prueba la conexión, revisa el modelo seleccionado o inténtalo de nuevo.",
    httpStatus: 400,
    category: "provider",
    retryable: false
  },
  API_PROVIDER_ERROR: {
    title: "Error interno del proveedor",
    userMessage: "El proveedor del motor IA reportó un error interno.",
    userAction: "Espera unos minutos y vuelve a intentar. Si continúa, prueba otro modelo en la configuración de la etapa.",
    httpStatus: 502,
    category: "provider",
    retryable: true
  },
  API_PROVIDER_UNAVAILABLE: {
    title: "Servicio del motor IA congestionado",
    userMessage: "El servicio del motor IA está muy cargado o no respondió a tiempo (saturación temporal).",
    userAction:
      "Espera un minuto y vuelve a intentar con el botón de la etapa. Si sigue igual, cambia el modelo en la configuración de esa etapa; no se cambia el modelo automáticamente.",
    httpStatus: 503,
    category: "provider",
    retryable: true
  },
  API_TIMEOUT: {
    title: "Tiempo agotado",
    userMessage: "El motor IA tardó demasiado en completar la solicitud.",
    userAction: "Vuelve a intentar. Si se repite, usa un archivo más corto o un modelo más rápido.",
    httpStatus: 504,
    category: "provider",
    retryable: true
  },
  AI_EMPTY_RESPONSE: {
    title: "Respuesta vacía",
    userMessage: "El motor IA no entregó respuesta para esta etapa.",
    userAction: "Vuelve a intentar o prueba otro modelo.",
    httpStatus: 502,
    category: "provider",
    retryable: true
  },
  AI_JSON_INVALID: {
    title: "JSON inválido",
    userMessage: "El motor IA respondió, pero no entregó un JSON válido.",
    userAction: "Reintentá la etapa. Si vuelve a pasar, probá otro modelo y revisá el JSON crudo.",
    httpStatus: 502,
    category: "format",
    retryable: true
  },
  AI_DATA_EMPTY: {
    title: "Sin items detectados",
    userMessage: "El motor IA respondió, pero no entregó items para procesar.",
    userAction: "Verifica que el archivo tenga texto o tablas legibles.",
    httpStatus: 422,
    category: "data",
    retryable: false
  },
  AI_DATA_INCOMPLETE: {
    title: "Datos incompletos",
    userMessage: "El motor IA respondió, pero el JSON no trae la estructura esperada.",
    userAction: "Revisá el JSON crudo y reintentá con el mismo archivo o con otro modelo.",
    httpStatus: 422,
    category: "data",
    retryable: true
  },
  AI_UNRELIABLE_PRICING: {
    title: "Fuentes no verificables",
    userMessage: "El motor IA respondió, pero algunas fuentes de precio no son confiables o parecen incompletas.",
    userAction: "Vuelve a ejecutar la Etapa 3 o prueba otro modelo. No uses ese resultado para cotizar sin revisión humana.",
    httpStatus: 422,
    category: "data",
    retryable: true
  },
  FILE_TEXT_EXTRACTION_FAILED: {
    title: "Archivo no legible",
    userMessage: "No se pudo extraer texto del archivo.",
    userAction: "Intenta con PDF con texto seleccionable, Word, Excel o TXT. Esta versión no hace OCR.",
    httpStatus: 400,
    category: "file",
    retryable: false
  },
  UNEXPECTED_ERROR: {
    title: "Error inesperado",
    userMessage: "Ocurrió un error inesperado durante el procesamiento.",
    userAction: "Vuelve a intentar y revisa el log técnico si se repite.",
    httpStatus: 500,
    category: "unknown",
    retryable: true
  }
};

export class PipelineFailure extends Error {
  code: AiFailureCode;
  stage: AiStage;
  technicalMessage: string;
  details?: Record<string, unknown>;
  raw?: string;
  result?: unknown;

  constructor(input: {
    code: AiFailureCode;
    stage: AiStage;
    technicalMessage?: string;
    details?: Record<string, unknown>;
    raw?: string;
    result?: unknown;
  }) {
    super(AI_FAILURES[input.code].userMessage);
    this.name = "PipelineFailure";
    this.code = input.code;
    this.stage = input.stage;
    this.technicalMessage = input.technicalMessage ?? AI_FAILURES[input.code].title;
    this.details = input.details;
    this.raw = input.raw;
    this.result = input.result;
  }

  get title() {
    return AI_FAILURES[this.code].title;
  }

  get userMessage() {
    return AI_FAILURES[this.code].userMessage;
  }

  get userAction() {
    return AI_FAILURES[this.code].userAction;
  }

  get category() {
    return AI_FAILURES[this.code].category;
  }

  get retryable() {
    return AI_FAILURES[this.code].retryable;
  }

  get httpStatus() {
    return AI_FAILURES[this.code].httpStatus;
  }
}

export function normalizePipelineFailure(error: unknown, stage: AiStage): PipelineFailure {
  if (error instanceof PipelineFailure) {
    return error;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);

  if (/falta configurar gemini_api_key|falta configurar gemini_model/i.test(rawMessage)) {
    return new PipelineFailure({ code: "CONFIG_MISSING", stage, technicalMessage: rawMessage });
  }

  if (/motor ia no devolvio contenido|gemini no devolvio contenido|gemini no devolvi/i.test(rawMessage)) {
    return new PipelineFailure({ code: "AI_EMPTY_RESPONSE", stage, technicalMessage: rawMessage });
  }

  const providerFailure = classifyProviderError(error);
  if (providerFailure) {
    return new PipelineFailure({
      code: providerFailure.code,
      stage,
      technicalMessage: providerFailure.technicalMessage,
      details: providerFailure.details
    });
  }

  return new PipelineFailure({
    code: "UNEXPECTED_ERROR",
    stage,
    technicalMessage: rawMessage
  });
}

export function failureToApiBody(failure: PipelineFailure) {
  return {
    error: failure.userMessage,
    errorCode: failure.code,
    errorTitle: failure.title,
    errorAction: failure.userAction,
    errorCategory: failure.category,
    retryable: failure.retryable,
    raw: failure.raw,
    result: failure.result
  };
}
