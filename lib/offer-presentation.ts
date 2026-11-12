import { z } from "zod";
import type { FinancialOfferItem, FinancialOfferProject } from "./contract";
import type { OfferPresentation } from "./financial-engine";

export const OfferDisplaySchema = z.object({
  original: z.boolean().optional(),
  text: z.enum(["auto", "combined", "separate", "name"]).optional(),
  showItem: z.boolean().optional(),
  showUnit: z.boolean().optional(),
}).strict();
export type OfferDisplay = z.infer<typeof OfferDisplaySchema>;
type Cell = { id: string; header: string; value: string | number | null };
type Field = "item" | "name" | "description" | "quantity" | "unit";
export type OfferColumn = { key: string; header: string; kind: "text" | "money" | "number" | "percent"; width: number };
export type OfferDisplayRow = { values: Record<string, string | number | null>; warnings: string[] };
const clean = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const patterns: Record<Field, RegExp> = {
  item: /^(?:item|no[. ]*item|numeral|ref[. ]*articulo|n[°º.]?|numero)$/,
  name: /^(?:nombre|elemento|elemnto|producto|articulo|objeto|nombre y descripcion)$/,
  description: /^(?:descripcion.*|caracteristicas.*|especificaciones.*)$/,
  quantity: /^(?:cantidad|cant[.]?)$/,
  unit: /^(?:unidad(?: de medida)?|und(?: de medida)?|u[.]?m[.]?)$/,
};
function columnsFor(item: FinancialOfferItem, field: Field): Cell[] {
  const org = item.dataOrganization;
  const columns = org?.original_capture === "literal" ? org.original_row?.columns ?? [] : [];
  const mapped = new Set(org?.normalization.filter(m => m.field === field).flatMap(m => m.column_ids));
  const explicit = columns.filter(c => mapped.has(c.id));
  return explicit.length ? explicit : columns.filter(c => patterns[field].test(clean(c.header)));
}
const cellValue = (cells: Cell[]) => cells.map(c => c.value === null ? "" : String(c.value)).join("\n");
function textFields(item: FinancialOfferItem) {
  const names = columnsFor(item, "name");
  const descriptions = columnsFor(item, "description").filter(c => !names.some(n => n.id === c.id));
  // A combined source cell stays whole; normalized AI text is never substituted for it.
  return { names, descriptions };
}
export function buildOfferDisplay(project: Pick<FinancialOfferProject, "items" | "settings">, offer: OfferPresentation) {
  const prefs = project.settings.offerDisplay ?? {};
  const hasLiteral = project.items.some(i => i.dataOrganization?.original_capture === "literal");
  const original = prefs.original !== false && (hasLiteral || project.items.some(i => i.sourceOriginal));
  const hasSeparate = original && project.items.some(i => { const f = textFields(i); return f.names.length && f.descriptions.length; });
  const separate = prefs.text === "separate" || (prefs.text !== "combined" && prefs.text !== "name" && hasSeparate);
  const title = (field: Field, fallback: string) => {
    if (!original) return fallback;
    const titles = [...new Set(project.items.flatMap(i => columnsFor(i, field).map(c => c.header)))];
    return titles.length === 1 ? titles[0]! : fallback;
  };
  const originalItemExists = project.items.some(i => columnsFor(i, "item").length);
  const originalUnitExists = project.items.some(i => columnsFor(i, "unit").length || (!i.dataOrganization?.original_row && i.sourceOriginal?.unit));
  const showItem = prefs.showItem ?? (!original || !hasLiteral || originalItemExists);
  const showUnit = prefs.showUnit ?? (!original || !hasLiteral || originalUnitExists);
  const textHeader = separate || prefs.text === "name" ? title("name", "Nombre") : (() => {
    const titles = [...new Set(project.items.flatMap(i => { const f = textFields(i); return [...f.names, ...f.descriptions].map(c => c.header); }))];
    return original && titles.length === 1 ? titles[0]! : "Descripción";
  })();
  const columns: OfferColumn[] = [
    ...(showItem ? [{key:"item",header:title("item", "Ítem"),kind:"text" as const,width:80}] : []),
    {key:"text",header:textHeader,kind:"text",width:280},
    ...(separate ? [{key:"description",header:title("description", "Descripción"),kind:"text" as const,width:320}] : []),
    {key:"quantity",header:title("quantity", "Cantidad"),kind:"number",width:76},
    ...(showUnit ? [{key:"unit",header:title("unit", "Unidad"),kind:"text" as const,width:95}] : []),
    {key:"unitPriceWithoutVat",header:"Unit. sin IVA",kind:"money",width:116},
    {key:"totalWithoutVat",header:"Total sin IVA",kind:"money",width:124},
    {key:"vatRatePct",header:"IVA %",kind:"percent",width:64},
    {key:"vatUnitValue",header:"IVA unit.",kind:"money",width:104},
    {key:"totalVatValue",header:"IVA total",kind:"money",width:110},
    {key:"unitPriceWithVat",header:"Unit. con IVA",kind:"money",width:116},
    {key:"totalWithVat",header:"Total con IVA",kind:"money",width:124},
  ];
  const rows: OfferDisplayRow[] = offer.rows.map((row, index) => {
    const item = project.items[index]!;
    const fields = textFields(item);
    const fallback = item.sourceOriginal;
    const sourceText = [...fields.names, ...fields.descriptions];
    const rawItem = columnsFor(item, "item");
    const rawUnit = columnsFor(item, "unit");
    let name = row.description, description = row.technicalDescription;
    if (original) {
      name = fields.names.length ? cellValue(fields.names) : fields.descriptions.length ? cellValue(fields.descriptions) : fallback?.description ?? row.description;
      description = fields.names.length ? cellValue(fields.descriptions) : "";
      if (!sourceText.length) description = fallback?.technical_description ?? "";
    }
    const warnings: string[] = [];
    const rawQuantity = columnsFor(item, "quantity");
    const numericQuantity = rawQuantity.length === 1 ? Number(String(rawQuantity[0]!.value).trim().replace(",", ".")) : NaN;
    if (original && Number.isFinite(numericQuantity) && rawQuantity[0]!.value !== null && numericQuantity !== row.quantity) warnings.push(`Cantidad del análisis ${row.quantity ?? "sin definir"}; original ${rawQuantity[0]!.value}. Revisar antes de ofertar.`);
    return { values: {
      item: original && rawItem.length ? cellValue(rawItem) : row.item,
      text: !original && !separate ? row.description : prefs.text === "name" || separate ? name : original && sourceText.length ? cellValue(sourceText) : [name, description].filter(Boolean).join("\n"),
      description,
      quantity: row.quantity,
      unit: original ? rawUnit.length ? cellValue(rawUnit) : fallback?.unit ?? row.unit : row.unit,
      unitPriceWithoutVat: row.unitPriceWithoutVat, totalWithoutVat: row.totalWithoutVat,
      vatRatePct: row.vatRatePct, vatUnitValue: row.vatUnitValue, totalVatValue: row.totalVatValue,
      unitPriceWithVat: row.unitPriceWithVat, totalWithVat: row.totalWithVat,
    }, warnings };
  });
  const notice = original
    ? "Textos originales en la oferta; precios y cantidades del análisis. Los campos combinados de origen se conservan completos."
    : "Presentación habitual. Los datos originales guardados se conservan para consulta.";
  return { columns, rows, original, showItem, showUnit, notice, hasLiteral };
}

// Bind originals to the existing offer slots; layout and financial rows stay unchanged.
export function buildOfferScreen(project: Pick<FinancialOfferProject, "items" | "settings">, offer: OfferPresentation): OfferPresentation {
  const display = buildOfferDisplay({ ...project, settings: { ...project.settings, offerDisplay: { ...project.settings.offerDisplay, text: "combined" } } }, offer);
  return { ...offer, rows: offer.rows.map((row, index) => {
    const source = display.rows[index]!;
    return { ...row, item: String(source.values.item ?? row.item), description: String(source.values.text ?? row.description), unit: String(source.values.unit ?? row.unit), warnings: [...row.warnings, ...source.warnings] };
  }) };
}

// Adapt the original metadata to the existing detail component, without introducing UI.
export function originalForItem(item: FinancialOfferItem) {
  const literal = item.dataOrganization?.original_capture === "literal" ? item.dataOrganization.original_row : undefined;
  if (!literal) return item.sourceOriginal;
  const source = item.sourceOriginal;
  const fields = textFields(item);
  const rawQuantity = columnsFor(item, "quantity"), rawUnit = columnsFor(item, "unit");
  return {
    document: literal.document || source?.document || "",
    locator: literal.locator || source?.locator || "",
    description: cellValue([...fields.names, ...fields.descriptions]) || source?.description || "",
    technical_description: source?.technical_description || "",
    quantity: rawQuantity.length ? cellValue(rawQuantity) : source?.quantity || "",
    unit: rawUnit.length ? cellValue(rawUnit) : source?.unit || "",
    ceiling_unit_price: source?.ceiling_unit_price || "",
  };
}
