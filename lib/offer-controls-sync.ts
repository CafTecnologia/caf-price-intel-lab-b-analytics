import type { FinancialOfferItem, FinancialOfferProject } from "./contract";
import { buildInitialOfferControls, buildRowKey, type OfferControl } from "./financial-engine";

export function isNewerExternalRevision(incoming: string, current: string): boolean {
  const incomingTime = Date.parse(incoming);
  const currentTime = Date.parse(current);
  return Number.isFinite(incomingTime) && Number.isFinite(currentTime) && incomingTime > currentTime;
}

function hasPersistedOfferControl(item: FinancialOfferItem, isAiStudy: boolean): boolean {
  // Autosave may persist the blank AI default before its ceiling arrives.
  if (isAiStudy && item.referenceUnit === null && item.offerMode === "discount" &&
      item.discountPct === 0 && item.manualOfferUnit === null) return false;
  return item.offerMode !== null ||
    item.discountPct !== null ||
    item.profitPct !== null ||
    item.manualOfferUnit !== null;
}

function sameOfferControl(left: OfferControl | undefined, right: OfferControl | undefined): boolean {
  return left?.mode === right?.mode &&
    left?.discountPct === right?.discountPct &&
    left?.profitPct === right?.profitPct &&
    left?.manualOfferUnit === right?.manualOfferUnit;
}

/**
 * Keeps a user-owned offer control intact while letting an untouched automatic
 * control follow an externally updated ceiling.
 */
export function synchronizePristineOfferControls(input: {
  previousItems: FinancialOfferItem[];
  nextItems: FinancialOfferItem[];
  controls: Record<string, OfferControl>;
  settings: FinancialOfferProject["settings"];
  sourceSystem?: FinancialOfferProject["sourceSystem"];
  iaRunId?: FinancialOfferProject["iaRunId"];
}): Record<string, OfferControl> {
  const identity = { sourceSystem: input.sourceSystem, iaRunId: input.iaRunId };
  const isAiStudy = Boolean(input.iaRunId) || input.sourceSystem === "odoo_caf";
  const previousAutomatic = buildInitialOfferControls({ items: input.previousItems, settings: input.settings, ...identity });
  const nextAutomatic = buildInitialOfferControls({ items: input.nextItems, settings: input.settings, ...identity });
  let nextControls = input.controls;

  input.previousItems.forEach((item, index) => {
    const rowKey = buildRowKey(item, index);
    const nextItem = input.nextItems[index];
    if (
      !nextItem || buildRowKey(nextItem, index) !== rowKey ||
      nextItem.referenceUnit === item.referenceUnit ||
      hasPersistedOfferControl(item, isAiStudy) ||
      !sameOfferControl(input.controls[rowKey], previousAutomatic[rowKey]) ||
      sameOfferControl(input.controls[rowKey], nextAutomatic[rowKey])
    ) {
      return;
    }
    nextControls = { ...nextControls, [rowKey]: nextAutomatic[rowKey]! };
  });

  return nextControls;
}
