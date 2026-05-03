export function formatBogotaDateTime(value: string | null | undefined): string {
  if (!value) return "N/D";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/D";
  const bogota = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const day = String(bogota.getUTCDate()).padStart(2, "0");
  const month = String(bogota.getUTCMonth() + 1).padStart(2, "0");
  const year = bogota.getUTCFullYear();
  const hour24 = bogota.getUTCHours();
  const hour12 = hour24 % 12 || 12;
  const minute = String(bogota.getUTCMinutes()).padStart(2, "0");
  const period = hour24 < 12 ? "a. m." : "p. m.";
  return `${day}/${month}/${year}, ${hour12}:${minute} ${period}`;
}
