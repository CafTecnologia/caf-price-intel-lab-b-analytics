import type { FinancialOfferProject } from "./contract";
import { isNewerExternalRevision } from "./offer-controls-sync";

/** A dirty editor must not acknowledge a newer revision with an older item list. */
export function externalRevisionDecision(input: {
  incoming: FinancialOfferProject;
  currentUpdatedAt: string;
  dirty: boolean;
  saving: boolean;
}): "ignore" | "defer" | "adopt" {
  if (!isNewerExternalRevision(input.incoming.updatedAt, input.currentUpdatedAt)) return "ignore";
  return input.dirty || input.saving ? "defer" : "adopt";
}
