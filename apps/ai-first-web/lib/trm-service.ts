import "server-only";

export type TrmSnapshot = {
  date: string;
  value: number;
  source: string;
};

const TRM_ENDPOINT = "https://www.datos.gov.co/resource/mcec-87by.json?$limit=1&$order=vigenciadesde DESC";
const FALLBACK_TRM: TrmSnapshot = {
  date: "2026-04-23",
  value: 3568.88,
  source: "Datos Abiertos Colombia / Superfinanciera",
};

export async function getOfficialTrmSnapshot(): Promise<TrmSnapshot> {
  try {
    const response = await fetch(TRM_ENDPOINT, {
      next: { revalidate: 60 * 60 * 12 },
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`TRM request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as Array<{ valor?: string; vigenciadesde?: string; unidad?: string }>;
    const latest = payload[0];
    if (!latest?.valor || !latest?.vigenciadesde) {
      throw new Error("TRM payload incompleto.");
    }

    return {
      date: latest.vigenciadesde.slice(0, 10),
      value: Number(latest.valor),
      source: "Datos Abiertos Colombia / Superfinanciera",
    };
  } catch {
    return FALLBACK_TRM;
  }
}
