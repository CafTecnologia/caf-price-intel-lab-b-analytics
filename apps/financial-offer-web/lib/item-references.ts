import type { FinancialOfferItem } from "./contract";

export type ItemReference = { itemId: string; label: string; searchText: string };

export function itemReference(item: FinancialOfferItem, index: number): ItemReference {
  const number = item.item.trim() || String(index + 1);
  const description = item.description.trim() || "Ítem sin descripción";
  return { itemId: item.id, label: `Ítem ${number}: ${description}`, searchText: `${number} ${description}`.toLocaleLowerCase("es-CO") };
}

export function searchItemReferences(items: FinancialOfferItem[], query: string): ItemReference[] {
  const term = query.trim().toLocaleLowerCase("es-CO");
  const references = items.map(itemReference);
  return term ? references.filter((reference) => reference.searchText.includes(term)) : references;
}

export function uniqueItemReferences(references: ItemReference[]): ItemReference[] {
  return references.filter((reference, index) => references.findIndex((candidate) => candidate.itemId === reference.itemId) === index);
}
