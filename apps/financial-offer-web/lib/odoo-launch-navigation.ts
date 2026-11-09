export type LaunchCalculationPreview = {
  id?: string;
  name?: string | null;
  odooProjectId?: string | null;
  items?: Array<{ description?: string; notes?: string }>;
};

export function isInitialPlaceholderCalculation(calculation: LaunchCalculationPreview | null | undefined): boolean {
  const items = calculation?.items;
  return (
    Array.isArray(items) &&
    items.length === 1 &&
    items[0]?.description === "Item pendiente" &&
    items[0]?.notes === "Cálculo creado para carga manual posterior."
  );
}

export function hasImportedItems(calculation: LaunchCalculationPreview | null | undefined): boolean {
  const items = calculation?.items;
  return Array.isArray(items) && items.length > 0 && !isInitialPlaceholderCalculation(calculation);
}

export function existingLaunchPath(
  launch: {
    calculationId?: string | null;
    odooProjectId?: string | null;
    odooCallbackUrl?: string | null;
    odooDb?: string | null;
  },
  calculation: LaunchCalculationPreview | null | undefined,
): string {
  const id = launch.calculationId?.trim();
  if (!id || calculation?.id !== id) {
    throw new Error("Odoo señala un cálculo que no se pudo verificar. No se creó otro borrador.");
  }
  if (launch.odooProjectId && calculation.odooProjectId && launch.odooProjectId !== calculation.odooProjectId) {
    throw new Error("El cálculo pertenece a otro proyecto. No se cambió el vínculo de Odoo.");
  }
  if (hasImportedItems(calculation)) {
    return `/calculations/${encodeURIComponent(id)}`;
  }
  const params = new URLSearchParams({ preparedCalculationId: id });
  if (calculation.name?.trim()) params.set("preparedCalculationName", calculation.name.trim());
  if (launch.odooCallbackUrl?.trim()) params.set("preparedCallbackUrl", launch.odooCallbackUrl.trim());
  if (launch.odooDb?.trim()) params.set("preparedOdooDb", launch.odooDb.trim());
  return `/?${params.toString()}`;
}

