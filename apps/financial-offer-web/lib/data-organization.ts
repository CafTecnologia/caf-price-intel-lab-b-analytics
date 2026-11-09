import { z } from "zod";

// Informational organization: prices remain exclusively in price_sources/additional_costs.
export const DataOrganizationSchema = z.object({
  version: z.literal(1),
  original_capture: z.enum(["literal", "legacy_fields_only"]),
  original_row: z.object({
    document: z.string().min(1),
    locator: z.string().min(1),
    columns: z.array(z.object({
      id: z.string().min(1),
      header: z.string(),
      header_path: z.array(z.string()).optional(),
      value: z.union([z.string(), z.number().finite(), z.null()]),
    }).strict()).min(1),
  }).strict().optional(),
  normalization: z.array(z.object({
    field: z.enum(["item", "name", "description", "quantity", "unit", "ceiling_unit_price"]),
    column_ids: z.array(z.string().min(1)).min(1),
    operation: z.enum(["copied", "split", "combined", "interpreted"]),
    note: z.string().min(1),
  }).strict()).default([]),
  components: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(["product", "service"]),
    quantity_per_deliverable: z.number().finite().positive(),
    relationship: z.enum(["included", "separate", "pending"]),
    factory_bundle: z.boolean().default(false),
    included_parts: z.array(z.string().min(1)).default([]),
    reason: z.string().min(1),
    additional_cost_id: z.string().min(1).optional(),
  }).strict()).default([]),
}).strict().superRefine((data, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({code: "custom", path, message});
  if (data.original_capture === "literal" && !data.original_row) issue(["original_row"], "La captura literal requiere la fila y sus encabezados.");
  if (data.original_capture === "legacy_fields_only" && data.original_row) issue(["original_row"], "No presentar campos antiguos como encabezados literales.");
  const columns = data.original_row?.columns.map(c => c.id) ?? [];
  if (new Set(columns).size !== columns.length) issue(["original_row", "columns"], "Los identificadores de columna deben ser únicos.");
  data.normalization.forEach((map, i) => {
    if (map.column_ids.some(id => !columns.includes(id))) issue(["normalization", i], "Columna original inexistente.");
  });
  const components = data.components.map(c => c.id);
  if (new Set(components).size !== components.length) issue(["components"], "Los componentes deben tener identificadores únicos.");
  const costs = data.components.flatMap(c => c.additional_cost_id ? [c.additional_cost_id] : []);
  if (new Set(costs).size !== costs.length) issue(["components"], "Un costo asociado no puede atribuirse dos veces.");
  data.components.forEach((c, i) => {
    if (c.additional_cost_id && c.relationship !== "separate") issue(["components", i], "Solo un componente separado puede vincular un costo asociado.");
    if (c.factory_bundle && c.included_parts.length === 0) issue(["components", i], "Identifique las piezas incluidas del conjunto de fábrica.");
  });
});
export type DataOrganization = z.output<typeof DataOrganizationSchema>;

export function validateOrganizationCosts(
  item: {data_organization?: DataOrganization; additional_costs: {id?: string | null}[]},
  ctx: z.RefinementCtx,
) {
  for (const [i, component] of (item.data_organization?.components ?? []).entries()) {
    if (component.additional_cost_id && !item.additional_costs.some(c => c.id === component.additional_cost_id)) {
      ctx.addIssue({code: "custom", path: ["data_organization", "components", i, "additional_cost_id"], message: "El costo asociado referenciado no existe en este entregable."});
    }
  }
}
