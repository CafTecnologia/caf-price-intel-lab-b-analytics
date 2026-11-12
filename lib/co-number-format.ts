// Cache presentation configuration only; never financial values or user data.
const variable = new Map<number, Intl.NumberFormat>();
const fixed = new Map<number, Intl.NumberFormat>();
export function coNumberFormat(digits = 0, fixedDecimals = false): Intl.NumberFormat {
  const cache = fixedDecimals ? fixed : variable;
  let formatter = cache.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("es-CO", fixedDecimals
      ? { minimumFractionDigits: digits, maximumFractionDigits: digits }
      : { maximumFractionDigits: digits });
    cache.set(digits, formatter);
  }
  return formatter;
}
