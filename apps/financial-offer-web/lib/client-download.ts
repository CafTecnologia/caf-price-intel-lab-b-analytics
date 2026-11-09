export async function downloadExport(url: string, fallbackName = "Oferta económica.xlsx"): Promise<void> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error ?? `No se pudo descargar el archivo (${response.status}).`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  const disposition = response.headers.get("content-disposition") ?? "";
  anchor.download = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
