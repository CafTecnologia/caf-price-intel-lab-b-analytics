import type { FinancialOfferProject } from "./contract";

export type RetentionDefaults = Pick<
  FinancialOfferProject["settings"],
  | "applyReteFuente"
  | "reteFuenteRate"
  | "reteFuenteBase"
  | "applyReteIva"
  | "reteIvaRate"
  | "reteIvaBase"
  | "applyReteIca"
  | "reteIcaRate"
  | "reteIcaBase"
>;

export function inheritedRetentionPatch(input: {
  explicitReteFuente: boolean;
  explicitReteIva: boolean;
  explicitReteIca: boolean;
  defaults: RetentionDefaults;
  existing?: RetentionDefaults | null;
}): Partial<RetentionDefaults> {
  const inherited = input.existing ?? input.defaults;
  return {
    ...(!input.explicitReteFuente ? {
      applyReteFuente: inherited.applyReteFuente,
      reteFuenteRate: inherited.reteFuenteRate,
      reteFuenteBase: inherited.reteFuenteBase,
    } : {}),
    ...(!input.explicitReteIva ? {
      applyReteIva: inherited.applyReteIva,
      reteIvaRate: inherited.reteIvaRate,
      reteIvaBase: inherited.reteIvaBase,
    } : {}),
    ...(!input.explicitReteIca ? {
      applyReteIca: inherited.applyReteIca,
      reteIcaRate: inherited.reteIcaRate,
      reteIcaBase: inherited.reteIcaBase,
    } : {}),
  };
}
