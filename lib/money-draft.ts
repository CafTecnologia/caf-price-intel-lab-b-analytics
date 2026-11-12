export function formatMoneyDraft(raw: string): string {
  const clean = raw.replace(/[^\d.,]/g, "");
  if (!clean) return "";
  const comma = clean.lastIndexOf(",");
  // En es-CO el punto escrito dentro de 1.000/50.000 es separador de miles.
  // Solo una cifra sin agrupar de al menos cuatro dígitos acepta punto decimal pegado.
  const decimalDot = comma < 0 && /^\d{4,}\.\d{1,2}$/.test(clean)
    ? clean.lastIndexOf(".") : -1;
  const separator = comma >= 0 ? comma : decimalDot;
  const integer = (separator >= 0 ? clean.slice(0, separator) : clean).replace(/\D/g, "");
  const decimal = separator >= 0 ? clean.slice(separator + 1).replace(/\D/g, "").slice(0, 2) : "";
  const grouped = (integer || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return separator >= 0 ? `${grouped},${decimal}` : grouped;
}
