import type { WorkProfile, WorkProfileRun, WorkSkill, WorkSkillKind } from "@/lib/work-profile-contract";

export type DriveFile = { id: string; name: string; path?: string; mimeType?: string; size?: string; md5Checksum?: string };

export type Launch = {
  analysisRecordId?: string;
  odooCallbackUrl?: string;
  odooReturnUrl?: string;
  project?: {
    id?: string;
    name?: string;
    processNumber?: string;
    entity?: string;
    driveFolderUrl?: string;
    object?: string;
    modality?: string;
    amount?: string;
    closingDate?: string;
    stage?: string;
    protocol?: { id?: string; name?: string; currentMoment?: string; moments?: string[]; tasks?: string[] };
    notes?: Array<{ at?: string; author?: string; text: string }>;
    companyKnowledge?: WorkProfileRun["project"]["companyKnowledge"];
  };
  drive?: { status: string; message: string; files: DriveFile[] };
};

export type OdooConnection = { baseUrl: string; db: string; token: string };

export type ExecutionPhase = "idle" | "resolving" | "downloading" | "cataloging" | "preparing" | "executing" | "syncing";

export type TestCase = {
  id: string;
  label: string;
  description: string;
  processNumber: string;
  expectedDecision: "viable" | "not_viable" | "indeterminate";
  expectedReason: string;
  fileCount: number;
  ready: boolean;
};

export type ProviderId = WorkProfileRun["providerId"];

export const DEFAULT_PROVIDER: ProviderId = "codex_vps";
export const DEFAULT_PROFILE_ID = "minimum_value_preanalysis_viability_v1";

const APP_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

export function appPath(pathname: string) {
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${APP_BASE_PATH}${clean}`;
}

/**
 * En modo empleado nadie elige el perfil: se resuelve desde la macrotarea que
 * Odoo envia en el lanzamiento. Si no hay coincidencia, cae al piloto de
 * pre-evaluacion y, en ultimo caso, al primer perfil publicado.
 */
export function candidatesForLaunch(profiles: WorkProfile[], launch: Launch | null): WorkProfile[] {
  const published = profiles.filter((entry) => entry.status === "published");
  const pool = published.length ? published : profiles;
  const macro = (launch?.project?.protocol?.currentMoment || "").trim().toLowerCase();
  if (!macro) return [];
  return pool
    .filter((entry) => entry.protocolScope?.macroStages.some((stage) => stage.label.trim().toLowerCase() === macro))
    // Orden estable: el almacen devuelve los perfiles por nombre de archivo y
    // eso hacia que la automatizacion elegida dependiera de un accidente.
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveProfileForLaunch(profiles: WorkProfile[], launch: Launch | null): WorkProfile | null {
  if (!profiles.length) return null;
  const published = profiles.filter((entry) => entry.status === "published");
  const pool = published.length ? published : profiles;
  const candidatos = candidatesForLaunch(profiles, launch);
  if (candidatos.length) {
    const preferido = candidatos.find((entry) => entry.id === DEFAULT_PROFILE_ID);
    return preferido || candidatos[0];
  }
  return pool.find((entry) => entry.id === DEFAULT_PROFILE_ID) || pool[0] || null;
}

export function phaseLabel(phase: ExecutionPhase) {
  if (phase === "resolving") return "Revisando el catalogo";
  if (phase === "downloading") return "Trayendo documentos nuevos";
  if (phase === "cataloging") return "Catalogando documentos";
  if (phase === "preparing") return "Preparando el analisis";
  if (phase === "executing") return "Ejecutando skills";
  if (phase === "syncing") return "Guardando en Odoo";
  return "Iniciar analisis";
}

export function phaseHelp(phase: ExecutionPhase) {
  if (phase === "resolving") return "Comprobando cuales de estos documentos ya se habian catalogado antes. Los conocidos no se vuelven a descargar.";
  if (phase === "downloading") return "Copiando desde Drive unicamente los archivos que el catalogo todavia no conoce.";
  if (phase === "cataloging") return "Inventariando formatos, paginas, tablas y secciones. La lectura profunda y el OCR quedan dirigidos por las skills.";
  if (phase === "preparing") return "Reuniendo el indice del proyecto para la etapa de analisis.";
  if (phase === "executing") return "Cada skill guarda su resultado antes de continuar con la siguiente.";
  if (phase === "syncing") return "El resultado ya existe; estamos confirmando el vinculo con el proyecto.";
  return "";
}

export function statusLabel(status: string) {
  if (status === "completed") return "Completado";
  if (status === "needs_review") return "Requiere revision";
  if (status === "running") return "En curso";
  if (status === "warning") return "Con advertencias";
  if (status === "failed") return "Fallido";
  if (status === "draft") return "Preparado";
  return status.replace(/_/g, " ");
}

export function decisionLabel(decision: string) {
  if (decision === "viable") return "Viable";
  if (decision === "not_viable") return "No viable";
  if (decision === "indeterminate") return "Indeterminada";
  return decision;
}

export function skillKindLabel(kind: WorkSkillKind) {
  if (kind === "document_map") return "Base documental";
  if (kind === "requirements") return "Requisitos";
  if (kind === "technical_scope") return "Alcance tecnico";
  if (kind === "economic_structure") return "Estructura economica";
  return "Supervision final";
}

export function customSkill(kind: Exclude<WorkSkillKind, "document_map" | "supervision">, current: WorkSkill[]): WorkSkill {
  const count = current.filter((skill) => skill.kind === kind).length + 1;
  const defaults: Record<Exclude<WorkSkillKind, "document_map" | "supervision">, Omit<WorkSkill, "id" | "kind">> = {
    requirements: {
      label: `Analizar requisitos ${count}`,
      purpose: "Define que requisitos debe localizar, comparar o clasificar esta skill.",
      instructions: ["Trabaja solo con evidencia verificable de los documentos preparados.", "Declara faltantes sin completar por intuicion."],
      requiredOutputKeys: ["requirements", "missingInformation"],
      sourceHints: ["requisito", "condicion", "habilitante"]
    },
    technical_scope: {
      label: `Analizar alcance ${count}`,
      purpose: "Define que elementos, cantidades o condiciones tecnicas debe estructurar esta skill.",
      instructions: ["Conserva la relacion con documento, pagina, tabla o fila.", "No mezcles listas parecidas sin identificar su funcion."],
      requiredOutputKeys: ["items", "coverage", "warnings"],
      sourceHints: ["lote", "item", "descripcion", "cantidad", "unidad"]
    },
    economic_structure: {
      label: `Analizar economia ${count}`,
      purpose: "Define que valores, presupuestos o estructura economica debe comprobar esta skill.",
      instructions: ["Distingue precios unitarios, subtotales y presupuesto total.", "No calcules valores que el documento no permita sustentar."],
      requiredOutputKeys: ["economicStructure", "warnings"],
      sourceHints: ["precio unitario", "presupuesto", "subtotal", "iva"]
    }
  };
  return { id: `custom_${kind}_${Date.now().toString(36)}_${count}`, kind, ...defaults[kind] };
}

export type { WorkProfile, WorkProfileRun, WorkSkill, WorkSkillKind };
