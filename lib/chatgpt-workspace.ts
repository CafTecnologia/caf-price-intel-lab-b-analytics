import "server-only";

import { type ChatGPTActor, assertCalculationAccess } from "./chatgpt-auth";
import { previewAnalysis, type AnalysisChange, type FinancialAnalysisScenario } from "./chatgpt-analysis";
import { buildInitialOfferControls, buildOfferPresentation, buildSimulation } from "./financial-engine";
import { getAnalysisWorkspaceSnapshot, listProjects } from "./store";
import { changeFinanceView, readFinanceView, FinanceViewConflictError, type FinanceViewState, type ViewFilter, type ViewSort } from "./chatgpt-view-state";

function requireView(value: FinanceViewState | null): FinanceViewState {
  if (!value) throw new FinanceViewConflictError("Abre un cálculo en la mesa antes de cambiar la vista.");
  return value;
}
function briefScenario(value: FinancialAnalysisScenario) {
  return { id: value.id, name: value.name, status: value.status, createdAt: value.createdAt,
    createdBy: value.createdBy, baseUpdatedAt: value.baseUpdatedAt,
    acceptanceOperationId: value.acceptanceOperationId };
}
function capacities(value: string): string[] {
  return [...new Set((value.match(/[0-9]{2,4}\s*(?:GB|TB|MB)/gi) ?? [])
    .map((part) => part.toUpperCase().replace(/\s+/g, " ")))];
}
function discrepancies(item: { sourceOriginal?: {description?: string; technical_description?: string}; technicalAnnex?: Array<{text:string}> }) {
  const original = capacities([item.sourceOriginal?.description, item.sourceOriginal?.technical_description].filter(Boolean).join(" "));
  const annex = capacities((item.technicalAnnex ?? []).map((entry) => entry.text).join(" "));
  if (!original.length || !annex.length || original.some((value) => annex.includes(value))) return [];
  return [{ kind: "capacity", label: "Capacidad distinta entre lista económica y anexo OCR", left: original.join(", "), right: annex.join(", ") }];
}
function sourceAge() {
  return process.env.CHATGPT_SANDBOX === "true" ? "Copia de pruebas; no se actualiza automáticamente." : undefined;
}

async function snapshot(actor: ChatGPTActor, calculationId: string) {
  const data = await getAnalysisWorkspaceSnapshot(calculationId);
  if (!data.project) throw new Error("Análisis no disponible.");
  await assertCalculationAccess(actor, data.project, false);
  return { project: data.project, scenarios: data.scenarios };
}

export async function financeWorkspaceView(actor: ChatGPTActor, state: FinanceViewState, action: string, preloaded?: Awaited<ReturnType<typeof snapshot>>) {
  const started = performance.now();
  const { project: current, scenarios } = preloaded ?? await snapshot(actor, state.calculationId);
  const scenario = state.scenarioId ? scenarios.find((entry) => entry.id === state.scenarioId) : null;
  if (state.scenarioId && !scenario) throw new Error("Escenario no disponible.");
  const staleDraft = state.draftChanges.length > 0 && state.dataUpdatedAt !== current.updatedAt;
  const draft = !scenario && !staleDraft && state.draftChanges.length
    ? previewAnalysis(current, state.draftChanges) : null;
  const project = scenario?.preview.project ?? draft?.project ?? current;
  const simulation = scenario?.preview.simulation ?? draft?.simulation ?? buildSimulation(current, buildInitialOfferControls(current));
  const baseline = scenario?.preview.originalSimulation ?? draft?.originalSimulation;
  const diff = scenario?.preview.diff ?? draft?.diff ?? [];
  const rowPairs = project.items.map((item, index) => ({ item, row: simulation.rows[index], index }));
  const losses = rowPairs.filter(({ row }) => row.status === "loss").length;
  const pending = rowPairs.filter(({ row, item }) => row.status === "incomplete" || item.costBasisStatus !== "conforming").length;
  const overCeiling = rowPairs.filter(({ row }) => row.status === "over_ceiling").length;
  const filtered = rowPairs.filter(({ row, item }) => state.filter === "all"
    || (state.filter === "loss" && row.status === "loss")
    || (state.filter === "over_ceiling" && row.status === "over_ceiling")
    || (state.filter === "pending" && (row.status === "incomplete" || item.costBasisStatus !== "conforming")));
  if (state.sort === "utility_asc") filtered.sort((left, right) => (left.row.utilityValue ?? Infinity) - (right.row.utilityValue ?? Infinity) || left.index - right.index);
  if (state.sort === "utility_desc") filtered.sort((left, right) => (right.row.utilityValue ?? -Infinity) - (left.row.utilityValue ?? -Infinity) || left.index - right.index);
  const selectedPair = state.selectedItemId ? rowPairs.find(({ item }) => item.id === state.selectedItemId) : undefined;
  const vatControls = Object.fromEntries(simulation.rows.map((row) => [row.rowKey, { mode: row.vatMode, ratePct: row.vatRatePct }]));
  const presentation = buildOfferPresentation(simulation, vatControls, project.settings);
  return {
    view: { version: state.version, calculationId: state.calculationId, scenarioId: state.scenarioId,
      filter: state.filter, sort: state.sort, selectedItemId: state.selectedItemId,
      displayedItemIds: filtered.map(({ item }) => item.id), updatedAt: current.updatedAt,
      viewUpdatedAt: state.updatedAt, sourceNotice: sourceAge(), staleDraft },
    analysis: { id: current.id, name: current.name, updatedAt: current.updatedAt, readOnly: current.readOnly,
      odooProcessNumber: current.odooProcessNumber, odooEntityName: current.odooEntityName },
    summary: simulation.summary,
    presentation: presentation.summary,
    counts: { all: rowPairs.length, loss: losses, pending, over_ceiling: overCeiling },
    rows: filtered.map(({ item, row }) => ({
      id: item.id, item: item.item, description: item.description, quantity: item.quantity,
      costUnit: row.costUnit, offerUnit: row.offerUnit, offerTotal: row.offerTotal,
      utilityValue: row.utilityValue, status: row.status, costBasisStatus: item.costBasisStatus,
      marginPctOnCost: row.marginPctOnCost, warningCount: row.warnings.length,
    })),
    selected: selectedPair ? { item: selectedPair.item, row: selectedPair.row, discrepancies: discrepancies(selectedPair.item) } : undefined,
    baseline: baseline?.summary, diff, scenarios: scenarios.map(briefScenario),
    draftChanges: state.draftChanges, scenario: scenario ? briefScenario(scenario) : undefined,
    evidence: { action, stateApplied: true, hostRendered: false, filter: state.filter, selectedItemId: state.selectedItemId,
      visibleCount: filtered.length, viewVersion: state.version },
    timings: { serverMs: Math.round(performance.now() - started) },
  };
}

export async function openFinanceWorkspace(actor: ChatGPTActor, calculationId?: string) {
  let chosen = calculationId;
  if (!chosen) {
    const projects = await listProjects();
    for (const project of projects) {
      if (/^(?:caf_chatgpt_synthetic|demo|qa(?:_|-|$))/i.test(project.sourceSystem ?? "") || /^\[(?:PRUEBAS|QA|DEMO)\]/i.test(project.name)) continue;
      try { await assertCalculationAccess(actor, project, false); chosen = project.id; break; }
      catch { continue; }
    }
  }
  if (!chosen) throw new Error("No hay cálculos reales disponibles.");
  const preloaded = await snapshot(actor, chosen);
  const { project } = preloaded;
  const state = await changeFinanceView(actor.id, null, () => ({
    calculationId: project.id, scenarioId: null, filter: "all", sort: "item",
    selectedItemId: null, draftChanges: [], dataUpdatedAt: project.updatedAt,
  }));
  return financeWorkspaceView(actor, state, "open", preloaded);
}

export async function getFinanceWorkspace(actor: ChatGPTActor) {
  const state = await readFinanceView(actor.id);
  if (!state) return { view: null, evidence: { action: "read", shown: false } };
  return financeWorkspaceView(actor, state, "read");
}

export async function filterFinanceWorkspace(
  actor: ChatGPTActor, expectedViewVersion: number, filter: ViewFilter, sort?: ViewSort,
) {
  const current = requireView(await readFinanceView(actor.id));
  const preloaded = await snapshot(actor, current.calculationId);
  const state = await changeFinanceView(actor.id, expectedViewVersion, (old) => ({
    ...requireView(old), filter, sort: sort ?? requireView(old).sort,
  }));
  return financeWorkspaceView(actor, state, "filter", preloaded);
}

export async function selectFinanceItem(actor: ChatGPTActor, expectedViewVersion: number, itemNumberOrId: string) {
  const current = requireView(await readFinanceView(actor.id));
  const preloaded = await snapshot(actor, current.calculationId);
  const { project } = preloaded;
  const matches = project.items.filter((item) => item.id === itemNumberOrId || item.item === itemNumberOrId);
  if (matches.length !== 1) throw new Error("Ítem ambiguo o no disponible.");
  const state = await changeFinanceView(actor.id, expectedViewVersion, (old) => ({
    ...requireView(old), selectedItemId: matches[0].id,
  }));
  return financeWorkspaceView(actor, state, "select", preloaded);
}

export async function showFinanceScenario(actor: ChatGPTActor, expectedViewVersion: number, scenarioId?: string) {
  const current = requireView(await readFinanceView(actor.id));
  const preloaded = await snapshot(actor, current.calculationId);
  const { scenarios } = preloaded;
  if (scenarioId && !scenarios.some((scenario) => scenario.id === scenarioId)) throw new Error("Escenario no disponible.");
  const state = await changeFinanceView(actor.id, expectedViewVersion, (old) => ({
    ...requireView(old), scenarioId: scenarioId ?? null, draftChanges: [],
  }));
  return financeWorkspaceView(actor, state, "scenario", preloaded);
}

export async function previewFinanceInView(
  actor: ChatGPTActor, expectedViewVersion: number, expectedUpdatedAt: string, changes: AnalysisChange[],
) {
  const current = requireView(await readFinanceView(actor.id));
  const preloaded = await snapshot(actor, current.calculationId);
  const { project } = preloaded;
  if (project.updatedAt !== expectedUpdatedAt) throw new FinanceViewConflictError("El cálculo cambió. Actualiza antes de simular.");
  previewAnalysis(project, changes);
  const state = await changeFinanceView(actor.id, expectedViewVersion, (old) => ({
    ...requireView(old), scenarioId: null, draftChanges: changes, dataUpdatedAt: project.updatedAt,
  }));
  return financeWorkspaceView(actor, state, "preview", preloaded);
}

export async function syncFinanceScenarioView(actor: ChatGPTActor, calculationId: string, scenarioId: string | null, dataUpdatedAt: string) {
  const current = await readFinanceView(actor.id);
  if (!current || current.calculationId !== calculationId) return;
  await changeFinanceView(actor.id, null, (old) => ({
    ...requireView(old), scenarioId, draftChanges: [], dataUpdatedAt,
  }));
}
