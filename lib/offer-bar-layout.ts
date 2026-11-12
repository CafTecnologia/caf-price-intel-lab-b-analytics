export type OfferBarLayout = {
  offerWidthPct: number;
  discountWidthPct: number;
  ceilingMarkerPct: number | null;
  excessWidthPct: number;
  costPct: number;
  utilityPct: number;
  deductionsPct: number;
  discount: number;
  excess: number;
  loss: number;
  isLoss: boolean;
};

function positive(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function share(value: number, base: number): number {
  return base > 0 ? (value / base) * 100 : 0;
}

export function offerBarLayout(input: {
  offer: number | null;
  ceiling: number | null;
  cost: number | null;
  netUtility: number | null;
  deductions: number | null;
}): OfferBarLayout {
  const offer = positive(input.offer);
  const ceiling = positive(input.ceiling);
  const cost = positive(input.cost);
  const deductions = positive(input.deductions);
  const utility = positive(input.netUtility);
  const loss = Math.max(0, -(input.netUtility ?? 0));
  const discount = ceiling > offer ? ceiling - offer : 0;
  const excess = input.ceiling !== null && offer > ceiling ? offer - ceiling : 0;
  const offerWidthPct = offer > 0 && ceiling > offer ? share(offer, ceiling) : 100;

  return {
    offerWidthPct,
    discountWidthPct: ceiling > offer ? 100 - offerWidthPct : 0,
    ceilingMarkerPct: excess > 0 ? share(ceiling, offer) : null,
    excessWidthPct: excess > 0 ? share(excess, offer) : 0,
    costPct: share(cost, offer),
    utilityPct: share(utility, offer),
    deductionsPct: share(deductions, offer),
    discount,
    excess,
    loss,
    isLoss: loss > 0,
  };
}
