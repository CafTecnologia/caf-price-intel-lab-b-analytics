import { NextResponse } from "next/server";
import { listWorkProfiles, saveWorkProfile } from "@/lib/work-profile-store";
import type { WorkProfile } from "@/lib/work-profile-contract";
import { validateWorkProfileDefinition } from "@/lib/work-profile-validation";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, profiles: await listWorkProfiles() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const profile = validateProfile(body.profile);
    const validation = validateWorkProfileDefinition(profile);
    if (body.publish === true && !validation.ok) {
      const failed = validation.checks.filter((entry) => !entry.ok).map((entry) => entry.message).join(" ");
      throw new Error(`El perfil sigue como borrador: ${failed}`);
    }
    return NextResponse.json({ ok: true, profile: await saveWorkProfile(profile, body.publish === true), validation });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

function validateProfile(value: unknown): WorkProfile {
  if (!value || typeof value !== "object") throw new Error("El perfil no es valido.");
  const profile = value as WorkProfile;
  if (profile.contract !== "caf-work-profile/v1") throw new Error("Contrato de perfil no soportado.");
  if (!/^[a-z0-9_-]{4,80}$/.test(String(profile.id))) throw new Error("El identificador del perfil no es valido.");
  if (!profile.label?.trim() || !profile.objective?.trim()) throw new Error("Nombre y objetivo son obligatorios.");
  if (!Array.isArray(profile.skills) || !profile.skills.length) throw new Error("El perfil necesita al menos una skill.");
  return profile;
}
