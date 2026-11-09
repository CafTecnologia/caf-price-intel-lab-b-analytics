import type { OriginalItem, SourceReference } from "./types";

export type DocumentIntakeProfileId = "procurement_items_v1" | (string & {});
export type DocumentIntakeStatus = "ready" | "needs_review" | "failed";
export type DocumentReferenceOutcome =
  | "unit_prices_found"
  | "derived_unit_prices"
  | "items_with_total_ceiling_only"
  | "items_without_reference_prices"
  | "insufficient_evidence";
export type DocumentRole =
  | "item_list"
  | "technical_specification"
  | "budget_or_market_study"
  | "addendum"
  | "economic_form"
  | "supporting"
  | "irrelevant"
  | "ambiguous";

export type DocumentIntakeProfile = {
  id: DocumentIntakeProfileId;
  label: string;
  description: string;
  purpose: string;
  outputContract: "procurement_items";
  requiredItemFields: Array<keyof Pick<OriginalItem, "name" | "description" | "unit" | "quantity" | "ceilingPrice">>;
  acceptedRoles: DocumentRole[];
  agentInstructions: string[];
};

export const DOCUMENT_INTAKE_PROFILES: DocumentIntakeProfile[] = [
  {
    id: "procurement_items_v1",
    label: "Articulos y precios de referencia",
    description: "Localiza listados de items, cantidades, unidades, fichas y precios techo.",
    purpose: "Preparar una fuente trazable para el flujo tecnico y comercial existente.",
    outputContract: "procurement_items",
    requiredItemFields: ["name", "unit", "quantity"],
    acceptedRoles: ["item_list", "economic_form", "budget_or_market_study", "addendum"],
    agentInstructions: [
      "Prioriza tablas que enumeren bienes o servicios solicitados.",
      "Usa anexos tecnicos para completar descripcion, pero no inventes campos ausentes.",
      "Distingue precios techo de cantidades, subtotales y valores globales.",
      "No mezcles versiones incompatibles ni adendas sin reportar el conflicto."
    ]
  }
];

export type DocumentInputSource = {
  kind: "upload" | "odoo_drive_file" | "odoo_drive_folder";
  projectId?: string;
  projectName?: string;
  folderUrl?: string;
};

export type DocumentIntakeDocument = {
  id: string;
  name: string;
  mimeType: string;
  extension: string;
  size: number;
  checksum: string;
  role: DocumentRole;
  relevance: "high" | "medium" | "low" | "unknown";
  parser: string;
  status: "processed" | "unsupported" | "failed";
  candidateItems: number;
  selected: boolean;
  reason: string;
  warnings: string[];
  priority?: "high" | "medium" | "low";
  hints?: string[];
  totalPages?: number;
  analyzedPages?: number[];
  processingMode?: "direct" | "focused" | "deep" | "deferred";
};

export type DocumentConflict = {
  code: "duplicate_item_mismatch" | "document_version_ambiguity" | "coverage_mismatch";
  itemId?: string;
  documentIds: string[];
  message: string;
};

export type DocumentIntakeEvidence = SourceReference & {
  documentId: string;
};

export type DocumentIntakeItem = OriginalItem & {
  evidence: DocumentIntakeEvidence[];
};

export type DocumentIntakeResult = {
  contract: "caf-document-intake/v1";
  profile: {
    id: DocumentIntakeProfileId;
    label: string;
    version: 1;
  };
  source: DocumentInputSource;
  status: DocumentIntakeStatus;
  documents: DocumentIntakeDocument[];
  items: DocumentIntakeItem[];
  coverage: {
    documentsFound: number;
    documentsProcessed: number;
    documentsSelected: number;
    candidateItems: number;
    extractedItems: number;
    supportedItems: number;
  };
  selection: {
    method: "agent" | "deterministic_fallback";
    providerId: string;
    summary: string;
  };
  resolution?: {
    outcome: DocumentReferenceOutcome;
    unitPriceItems: number;
    derivedPriceItems: number;
    totalCeiling?: string;
    reason: string;
  };
  conflicts: DocumentConflict[];
  warnings: string[];
  createdAt: string;
};

export function documentIntakeProfile(value: unknown) {
  return DOCUMENT_INTAKE_PROFILES.find((profile) => profile.id === value)
    || DOCUMENT_INTAKE_PROFILES[0];
}
