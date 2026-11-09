import { describe, expect, it } from "vitest";

import { itemReference, searchItemReferences, uniqueItemReferences } from "../lib/item-references";
import type { FinancialOfferItem } from "../lib/contract";

function item(id: string, number: string, description: string): FinancialOfferItem {
  return { id, item: number, description } as FinancialOfferItem;
}

describe("referencias de ítems para el chat", () => {
  it("mantiene IDs distintos cuando las etiquetas son iguales", () => {
    const items = [item("a", "7", "Cable"), item("b", "7", "Cable")];
    const matches = searchItemReferences(items, "cable");
    expect(matches.map((match) => match.itemId)).toEqual(["a", "b"]);
    expect(uniqueItemReferences([matches[0]!, matches[1]!, matches[0]!])).toHaveLength(2);
  });

  it("muestra una etiqueta humana sin revelar el ID", () => {
    expect(itemReference(item("interno-42", "3", "Tornillo"), 0)).toMatchObject({ itemId: "interno-42", label: "Ítem 3: Tornillo" });
  });
});
