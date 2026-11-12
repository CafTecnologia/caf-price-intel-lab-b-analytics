
import type { FinancialOfferProject } from "./contract";
import { currentPriceBaseStateDigest } from "./store";
import type { CalculationOperationsReceipt, PriceBaseVersion } from "./store";

const FIELD_LABELS: Record<string, string> = {
  item: "Ítem",
  name: "Nombre",
  description: "Descripción",
  technicalDescription: "Ficha técnica",
  source_original: "Texto original",
  sourceOriginal: "Texto original",
  technical_annex: "Anexo técnico",
  technicalAnnex: "Anexo técnico",
  cost_basis_status: "Estado de la base de costos",
  costBasisStatus: "Estado de la base de costos",
  quantity: "Cantidad",
  unit: "Unidad",
  ceiling_unit_price: "Precio techo unitario",
  referenceUnit: "Precio techo unitario",
  price_sources: "Fuentes de precio",
  priceSources: "Fuentes de precio",
  deliverable_type: "Tipo de entregable",
  deliverableType: "Tipo de entregable",
  additional_costs: "Costos asociados",
  additionalCosts: "Costos asociados",
  notes: "Notas",
  selected_cost_mode: "Modo de costo",
  selectedCostMode: "Modo de costo",
  manual_unit_cost: "Costo unitario manual",
  manualUnitCost: "Costo unitario manual",
  manual_reference_total: "Presupuesto global",
  general_cost: "Costo general",
};

export type AiResultEvidenceChange = {
  itemId: string;
  item: string;
  field: string;
  fieldLabel: string;
  before: unknown;
  after: unknown;
};

export type AiResultEvidenceReceipt = {
  operationId: string;
  status: "applied" | "no_changes";
  baseVersionId: string;
  createdAt: string;
  active: boolean;
  historical: boolean;
  changedItemCount: number;
  changedItemIds: string[];
  changes: AiResultEvidenceChange[];
  comparison: {
    scope: "this_request";
    versionId: string;
    parentVersionId: string | null;
    basis: "receipt_changes" | "unavailable";
    diffs: AiResultEvidenceChange[];
  };
};

export type AiResultIntegrityIssue = {
  operationId?: string;
  code: "receipt_binding_mismatch" | "invalid_source" | "invalid_status" | "missing_base_version"
    | "foreign_base_version" | "base_version_job_mismatch" | "base_version_run_mismatch"
    | "applied_without_changes" | "corrupted_no_changes";
};

export type AiResultEvidence = {
  calculationId: string;
  odooProjectId: string;
  externalRunId: string;
  jobId: string;
  receiptCount: number;
  appliedReceiptCount: number;
  noChangesReceiptCount: number;
  uniqueChangedItemCount: number;
  rejectedReceiptCount?: number;
  integrityIssues?: AiResultIntegrityIssue[];
  receipts: AiResultEvidenceReceipt[];
};

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field.replaceAll("_", " ");
}

function readableChange(change: CalculationOperationsReceipt["changes"][number]): AiResultEvidenceChange {
  return {
    itemId: change.itemId,
    item: change.item,
    field: change.field,
    fieldLabel: labelFor(change.field),
    before: structuredClone(change.before),
    after: structuredClone(change.after),
  };
}

export function buildAiResultEvidence(input: {
  calculation: FinancialOfferProject;
  jobId: string;
  receipts: CalculationOperationsReceipt[];
  versions: PriceBaseVersion[];
}): AiResultEvidence {
  const { calculation, jobId } = input;
  if (!calculation.odooProjectId || !calculation.externalId) {
    throw new Error("El cálculo no tiene un vínculo completo con Odoo y la corrida externa.");
  }
  const versions = new Map(input.versions.map((version) => [version.id, version]));
  const currentStateDigest = currentPriceBaseStateDigest(calculation);
  const integrityIssues: AiResultIntegrityIssue[] = [];
  const certified = input.receipts.filter((receipt) => {
    if (receipt.jobId !== jobId) return false;
    if (receipt.calculationId !== calculation.id || receipt.externalRunId !== calculation.externalId) {
      integrityIssues.push({ code: "receipt_binding_mismatch" });
      return false;
    }
    if (receipt.source !== "ai") {
      integrityIssues.push({ operationId: receipt.operationId, code: "invalid_source" });
      return false;
    }
    if (!(["applied", "no_changes"] as string[]).includes(receipt.status)) {
      integrityIssues.push({ operationId: receipt.operationId, code: "invalid_status" });
      return false;
    }
    const version = versions.get(receipt.baseVersionId);
    if (!version) {
      integrityIssues.push({ operationId: receipt.operationId, code: "missing_base_version" });
      return false;
    }
    if (version.projectId !== calculation.id) {
      integrityIssues.push({ operationId: receipt.operationId, code: "foreign_base_version" });
      return false;
    }
    const versionRunId = (version as PriceBaseVersion & { externalRunId?: string }).externalRunId;
    if (versionRunId !== undefined && versionRunId !== receipt.externalRunId) {
      integrityIssues.push({ operationId: receipt.operationId, code: "base_version_run_mismatch" });
      return false;
    }
    if (receipt.status === "applied") {
      if (receipt.changes.length === 0) {
        integrityIssues.push({ operationId: receipt.operationId, code: "applied_without_changes" });
        return false;
      }
      if (version.source !== "ai" || version.jobId !== receipt.jobId) {
        integrityIssues.push({ operationId: receipt.operationId, code: "base_version_job_mismatch" });
        return false;
      }
    } else if (receipt.status === "no_changes" && (receipt.changes.length > 0
      || receipt.createdItemIds.length > 0 || receipt.updatedItemIds.length > 0)) {
      integrityIssues.push({ operationId: receipt.operationId, code: "corrupted_no_changes" });
      return false;
    }
    return true;
  });
  const receipts = certified
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)
      || left.operationId.localeCompare(right.operationId))
    .map((receipt): AiResultEvidenceReceipt => {
      const version = versions.get(receipt.baseVersionId)!;
      const changes = receipt.changes.map(readableChange);
      const active = Boolean(version?.stateDigest && version.stateDigest === currentStateDigest);
      const realItemIds = new Set([
        ...calculation.items.map((item) => item.id),
        ...version.snapshot.map((item) => item.id),
      ]);
      const changedItemIds = [...new Set([
        ...receipt.createdItemIds,
        ...receipt.updatedItemIds,
        ...changes.map((change) => change.itemId),
      ].filter((itemId) => realItemIds.has(itemId)))];
      return {
        operationId: receipt.operationId,
        status: receipt.status,
        baseVersionId: receipt.baseVersionId,
        createdAt: receipt.updatedAt,
        active,
        historical: !active,
        changedItemCount: changedItemIds.length,
        changedItemIds,
        changes,
        comparison: {
          scope: "this_request",
          versionId: receipt.baseVersionId,
          parentVersionId: version?.parentId ?? null,
          basis: changes.length ? "receipt_changes" : "unavailable",
          diffs: changes,
        },
      };
    });
  const uniqueChangedItems = new Set(receipts.flatMap((receipt) => receipt.changedItemIds));
  return {
    calculationId: calculation.id,
    odooProjectId: calculation.odooProjectId,
    externalRunId: calculation.externalId,
    jobId,
    receiptCount: receipts.length,
    appliedReceiptCount: receipts.filter((receipt) => receipt.status === "applied").length,
    noChangesReceiptCount: receipts.filter((receipt) => receipt.status === "no_changes").length,
    uniqueChangedItemCount: uniqueChangedItems.size,
    rejectedReceiptCount: integrityIssues.length,
    integrityIssues,
    receipts,
  };
}
