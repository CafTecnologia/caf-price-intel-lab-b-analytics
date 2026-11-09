import { NextResponse } from "next/server";
import { getOfficialTrmSnapshot } from "@/lib/official-trm";

export const runtime = "nodejs";

/** TRM USD/COP para equivalencias en UI (fuente oficial con respaldo opcional vía env). */
export async function GET() {
  const snap = await getOfficialTrmSnapshot();
  if (!snap.ok) {
    return NextResponse.json({ value: null, error: snap.error }, { status: 503 });
  }
  return NextResponse.json({
    value: snap.value,
    vigenciadesde: snap.vigenciadesde,
    vigenciahasta: snap.vigenciahasta,
    source: snap.source,
    fromOfficialDataset: snap.fromOfficialDataset
  });
}
