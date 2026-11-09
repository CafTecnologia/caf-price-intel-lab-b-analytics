import { NextResponse } from "next/server";
import { doclingHealth } from "@/lib/docling-client";
import { DOCUMENT_INTAKE_PROFILES } from "@/lib/document-intake-contract";

export const runtime = "nodejs";

export async function GET() {
  const converter = await doclingHealth();
  return NextResponse.json({
    ok: converter.ok,
    contract: "caf-document-intake/v1",
    converter,
    profiles: DOCUMENT_INTAKE_PROFILES.map((profile) => ({
      id: profile.id,
      label: profile.label,
      description: profile.description,
      outputContract: profile.outputContract
    }))
  }, { status: converter.ok ? 200 : 503 });
}
