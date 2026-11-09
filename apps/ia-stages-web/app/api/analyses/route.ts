import { NextResponse } from "next/server";
import { createAnalysis, listAnalyses } from "@/lib/run-history";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? 50);
  const projectOdooId = searchParams.get("projectOdooId")?.trim() || undefined;
  const analyses = listAnalyses(Number.isFinite(limit) ? limit : 50, projectOdooId ?? null);
  return NextResponse.json({ analyses });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { odooProjectId?: string | null; title?: string | null };
    const odoo =
      typeof body.odooProjectId === "string" && body.odooProjectId.trim() ? body.odooProjectId.trim() : null;
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
    const analysis = createAnalysis({ odooProjectId: odoo, title });
    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo crear el análisis." },
      { status: 500 }
    );
  }
}
