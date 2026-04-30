import { NextResponse } from "next/server";

import { fetchOdooProjectOptions } from "@web/lib/odoo-projects";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? undefined;
    const q = url.searchParams.get("q") ?? undefined;
    const rawLimit = Number(url.searchParams.get("limit") ?? 120);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 300) : 120;
    const projects = await fetchOdooProjectOptions({ id, q, limit });

    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar proyectos de Odoo." },
      { status: 500 },
    );
  }
}
