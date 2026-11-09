import type { AiProvider } from "@/lib/config";

export type WorkProfileId = "default" | "medio" | "avanzado" | "manual";

export type StageModelsTriple = {
  stage1: string;
  stage2: string;
  stage3: string;
};

export type StageProvidersTriple = {
  stage1: AiProvider;
  stage2: AiProvider;
  stage3: AiProvider;
};

export const WORK_PROFILE_OPTIONS: Array<{
  id: WorkProfileId;
  title: string;
  description: string;
}> = [
  {
    id: "default",
    title: "Estándar",
    description:
      "Modelos ágiles. La configuración óptima y segura para procesar la mayoría de pliegos y documentos."
  },
  {
    id: "medio",
    title: "Alta Precisión",
    description:
      "Modelos de mayor capacidad analítica en las etapas iniciales para pliegos con alta densidad técnica."
  },
  {
    id: "avanzado",
    title: "Máxima Potencia",
    description:
      "Máxima capacidad en todo el flujo. Usa el motor más potente disponible para la etapa crítica de cotización y validación de fuentes."
  },
  {
    id: "manual",
    title: "Manual",
    description: "No se cambian los modelos al elegir este perfil: se usan los que tengas en la configuración por etapa."
  }
];

/**
 * Asignación de modelos Google por perfil (sin prefijo `gemini:`).
 * Etapa 3 siempre Gemini (búsqueda / grounding).
 */
export function getGeminiStageModelsForWorkProfile(profile: Exclude<WorkProfileId, "manual">): StageModelsTriple {
  if (profile === "default") {
    return {
      stage1: "gemini-3.1-flash-lite",
      stage2: "gemini-3.1-flash-lite",
      stage3: "gemini-3.1-flash-lite"
    };
  }
  if (profile === "medio") {
    return {
      stage1: "gemini-3.1-flash-lite",
      stage2: "gemini-3.1-flash-lite",
      stage3: "gemini-3.5-flash"
    };
  }
  return {
    stage1: "gemini-3.5-flash",
    stage2: "gemini-3.5-flash",
    stage3: "gemini-3.1-pro-preview"
  };
}

export function getStageProvidersAllGemini(): StageProvidersTriple {
  return { stage1: "gemini", stage2: "gemini", stage3: "gemini" };
}

export function isWorkProfileId(value: unknown): value is WorkProfileId {
  return value === "default" || value === "medio" || value === "avanzado" || value === "manual";
}
