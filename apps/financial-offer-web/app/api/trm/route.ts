import { NextResponse } from "next/server";

const TRM_SOURCE_URL = "https://www.datos.gov.co/resource/32sa-8pi3.json?$select=valor,unidad,vigenciadesde,vigenciahasta&$order=vigenciadesde%20DESC&$limit=1";

type DatosGovTrmRow = {
  valor?: string;
  unidad?: string;
  vigenciadesde?: string;
  vigenciahasta?: string;
};

function parseTrm(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET() {
  try {
    const response = await fetch(TRM_SOURCE_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `No se pudo consultar la TRM. Codigo ${response.status}.`,
          source: "Datos Abiertos Colombia / Superfinanciera",
          sourceUrl: TRM_SOURCE_URL,
        },
        { status: 502 },
      );
    }

    const rows = (await response.json()) as DatosGovTrmRow[];
    const row = rows[0];
    const value = parseTrm(row?.valor);

    if (!row || value === null) {
      return NextResponse.json(
        {
          ok: false,
          error: "La fuente de TRM no devolvio un valor valido.",
          source: "Datos Abiertos Colombia / Superfinanciera",
          sourceUrl: TRM_SOURCE_URL,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      value,
      unit: row.unidad ?? "COP",
      validFrom: row.vigenciadesde ?? null,
      validTo: row.vigenciahasta ?? null,
      fetchedAt: new Date().toISOString(),
      source: "Datos Abiertos Colombia / Superfinanciera",
      sourceUrl: TRM_SOURCE_URL,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "No se pudo consultar la TRM.",
        source: "Datos Abiertos Colombia / Superfinanciera",
        sourceUrl: TRM_SOURCE_URL,
      },
      { status: 502 },
    );
  }
}
