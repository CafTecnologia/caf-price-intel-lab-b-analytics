import type { WorkProfileProtocolScope, WorkProfileProjectContext } from "./work-profile-contract";

export type WorkProtocolDefinition = {
  id: string;
  label: string;
  macroStages: WorkProfileProtocolScope["macroStages"];
};

export const BUILTIN_WORK_PROTOCOLS: WorkProtocolDefinition[] = [{
  id: "61",
  label: "Piloto Minima Cuantia Carlos",
  macroStages: [{
    id: "pre-evaluacion",
    label: "Pre-evaluacion",
    objective: "Identificar requisitos limitantes que pueden impedir continuar el pre-analisis.",
    expectedResult: "Decision normalizada sobre si la Pre-evaluacion puede continuar: viable, no viable o indeterminada.",
    recommendedOutputContract: "caf-project-viability-screen/v1",
    completionCriteria: [
      "Cada limitante tiene documento, ubicacion y fragmento verificable.",
      "La compatibilidad empresarial se sustenta o queda explicitamente sin evaluar.",
      "La respuesta se limita a la macrotarea seleccionada."
    ],
    taskReferences: ["Pre-evaluacion"]
  }]
}];

export function protocolFromProject(protocol?: WorkProfileProjectContext["protocol"]): WorkProtocolDefinition | null {
  if (!protocol?.name) return null;
  const known = BUILTIN_WORK_PROTOCOLS.find((entry) => entry.id === protocol.id || entry.label === protocol.name);
  if (known) return known;
  const stageNames = [...new Set([...(protocol.moments || []), protocol.currentMoment, ...(protocol.tasks || [])].filter(Boolean) as string[])];
  return {
    id: protocol.id || slug(protocol.name),
    label: protocol.name,
    macroStages: stageNames.map((label) => ({
      id: slug(label),
      label,
      objective: `Resolver exclusivamente el trabajo correspondiente a ${label}.`,
      expectedResult: `Resultado normalizado y sustentado para completar ${label}.`,
      recommendedOutputContract: "caf-project-initial-assessment/v1",
      completionCriteria: ["La evidencia corresponde a los documentos del proyecto.", "Los faltantes materiales quedan declarados."],
      taskReferences: (protocol.tasks || []).filter((task) => task === label)
    }))
  };
}

export function composeProtocolObjective(scope: WorkProfileProtocolScope) {
  const stages = scope.macroStages.map((stage) => stage.label).join(", ");
  const results = scope.macroStages.map((stage) => stage.expectedResult.replace(/\.$/, "")).join("; ");
  return `Trabajar exclusivamente las macrotareas ${stages} del protocolo ${scope.protocolName}. Resultado esperado: ${results}.`;
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "macroetapa";
}
