export type OfferComposition = {
  costPct: number;
  utilityPct: number;
  costWidthPct: number;
  utilityWidthPct: number;
  discountPct: number;
  excessPct: number;
  lossPct: number;
};

export type SettlementComposition = {
  costPct: number;
  netUtilityPct: number;
  deductionsPct: number;
  costWidthPct: number;
  netUtilityWidthPct: number;
  deductionsWidthPct: number;
  discountPct: number;
  excessPct: number;
  lossPct: number;
};

function positive(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function share(value: number, base: number): number {
  return base > 0 ? (value / base) * 100 : 0;
}

function normalizedWidths(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + positive(value), 0);
  if (total <= 0) return values.map(() => 0);
  return values.map((value) => (positive(value) / total) * 100);
}

function referenceDelta(offer: number | null, ceiling: number | null): { discountPct: number; excessPct: number } {
  if (!offer || offer <= 0 || !ceiling || ceiling <= 0) {
    return { discountPct: 0, excessPct: 0 };
  }
  const deltaPct = ((ceiling - offer) / ceiling) * 100;
  return {
    discountPct: Math.max(0, deltaPct),
    excessPct: Math.max(0, -deltaPct),
  };
}

export function offerCompositionPercent(input: {
  offer: number | null;
  cost: number | null;
  utility: number | null;
  ceiling: number | null;
}): OfferComposition {
  const offer = positive(input.offer);
  const cost = positive(input.cost);
  const utility = positive(input.utility);
  const loss = Math.max(0, -(input.utility ?? 0));
  const [costWidthPct, utilityWidthPct] = normalizedWidths([cost, utility]);
  const reference = referenceDelta(input.offer, input.ceiling);

  return {
    costPct: share(cost, offer),
    utilityPct: share(utility, offer),
    costWidthPct,
    utilityWidthPct,
    ...reference,
    lossPct: share(loss, offer),
  };
}

export function settlementCompositionPercent(input: {
  offer: number | null;
  cost: number | null;
  netUtility: number | null;
  deductions: number | null;
  ceiling: number | null;
}): SettlementComposition {
  const offer = positive(input.offer);
  const cost = positive(input.cost);
  const deductions = positive(input.deductions);
  const netUtility = positive(input.netUtility);
  const loss = Math.max(0, -(input.netUtility ?? 0));
  const [costWidthPct, netUtilityWidthPct, deductionsWidthPct] = normalizedWidths([cost, netUtility, deductions]);
  const reference = referenceDelta(input.offer, input.ceiling);

  return {
    costPct: share(cost, offer),
    netUtilityPct: share(netUtility, offer),
    deductionsPct: share(deductions, offer),
    costWidthPct,
    netUtilityWidthPct,
    deductionsWidthPct,
    ...reference,
    lossPct: share(loss, offer),
  };
}

export type GlobalOfferCeilingComparison = {
  status: "no_ceiling" | "no_offer" | "within" | "at_limit" | "exceeded";
  difference: number | null;
  partial: boolean;
};

/** The whole-contract ceiling applies to the registered gross offer, regardless of costs. */
export function globalOfferCeilingComparison(input: {
  ceiling: number | null;
  grossOffer: number;
  offeredItemCount: number;
  itemCount: number;
}): GlobalOfferCeilingComparison {
  const partial = input.offeredItemCount < input.itemCount;
  if (input.ceiling === null) return { status: "no_ceiling", difference: null, partial };
  if (input.offeredItemCount === 0) return { status: "no_offer", difference: null, partial };
  const difference = input.ceiling - input.grossOffer;
  return { status: difference < 0 ? "exceeded" : difference === 0 ? "at_limit" : "within", difference, partial };
}
