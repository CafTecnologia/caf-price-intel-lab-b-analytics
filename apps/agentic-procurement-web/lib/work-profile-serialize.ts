import type { WorkProfileRun } from "./work-profile-contract";

export type PublicRun = Omit<WorkProfileRun, "documents" | "skills"> & {
  documents: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
};

function publicDocument(document: unknown): Record<string, unknown> {
  const source = document as Record<string, unknown>;
  const index: Record<string, unknown> = { ...source };
  delete index.text;
  delete index.sourceRef;
  index.textLength = String(source.text || "").length;
  if (Array.isArray(source.chunks)) {
    index.chunks = source.chunks.map((chunk) => {
      const entry = chunk as Record<string, unknown>;
      return { location: entry.location, method: entry.method, hints: entry.hints };
    });
  }
  // El titulo de cada seccion es una linea literal del documento. Se conserva
  // la ubicacion, que es estructura, y se descarta el texto.
  if (Array.isArray(source.sections)) {
    index.sections = source.sections.map((section) => {
      const entry = section as Record<string, unknown>;
      return { location: entry.location, hints: entry.hints };
    });
  }
  return index;
}

function publicSkill(skill: unknown): Record<string, unknown> {
  const source = skill as Record<string, unknown>;
  const entry: Record<string, unknown> = { ...source };
  // El prompt lleva los extractos que se enviaron al modelo y rawResponse su
  // respuesta cruda: entre los dos republicaban el corpus entero por HTTP.
  delete entry.prompt;
  delete entry.rawResponse;
  entry.promptLength = String(source.prompt || "").length;
  entry.responseLength = String(source.rawResponse || "").length;
  return entry;
}

/**
 * Vista publica de una corrida: metadatos, estado, evidencia normalizada.
 * Nunca el texto fuente ni lo que se le mando al modelo.
 */
export function publicRun(run: WorkProfileRun): PublicRun {
  return {
    ...run,
    documents: (run.documents || []).map(publicDocument),
    skills: (run.skills || []).map(publicSkill)
  };
}

/**
 * El listado alimenta directamente la pantalla de resultado, asi que conserva
 * artefacto y estado de cada skill. Lo que se va es el peso muerto: quitar
 * prompt y rawResponse baja la respuesta de 17,4 MB a cerca de 1 MB.
 */
export function publicRuns(runs: WorkProfileRun[]): PublicRun[] {
  return runs.map(publicRun);
}
