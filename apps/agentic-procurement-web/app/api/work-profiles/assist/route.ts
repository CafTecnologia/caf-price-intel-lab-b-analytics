import { NextResponse } from "next/server";
import { runProviderTask } from "@/lib/providers";
import { safeJsonFromText } from "@/lib/utils";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const providerId = (["codex_pc", "codex_vps", "mock"].includes(body.providerId) ? body.providerId : "codex_vps") as ProviderId;
    const prompt = [
      "# Asistente de diseno de perfiles IA de CAF",
      "Ayuda a una persona no tecnica a crear o mejorar un perfil de trabajo documental.",
      "Si el perfil recibido tiene status=draft y un id custom_profile_*, tratalo como una creacion desde cero sobre la base documental existente.",
      "Puedes proponer una variante con nuevo id, pipeline y contrato solo si la peticion cambia la tarea final.",
      "Contratos soportados: caf-project-initial-assessment/v1 (mapa, requisitos, alcance, economia, supervision) y caf-project-viability-screen/v1 (mapa, requisitos, supervision).",
      "Skills soportadas: document_map, requirements, technical_scope, economic_structure y supervision. Supervision siempre va al final.",
      "La primera skill document_map es una base tecnica ya probada: no la elimines ni debilites. Personaliza las skills posteriores.",
      "Puedes proponer skills adicionales de tipos soportados cuando dividan una tarea real y cada una tenga objetivo, instrucciones y salida verificable.",
      "Para viabilidad exige viable, not_viable o indeterminate; nunca fuerces una decision binaria sin evidencia.",
      "Toda variante nueva queda status=draft, version=1 y conserva guardrails de evidencia e incertidumbre.",
      "Convierte la peticion humana en cambios pequenos, verificables y especificos.",
      "Nunca publiques: devuelve una propuesta de borrador.",
      "Devuelve exclusivamente JSON: {\"summary\":\"...\",\"risks\":[\"...\"],\"proposedProfile\":{...perfil completo...},\"testsToRun\":[\"...\"]}",
      "PERFIL ACTUAL:", JSON.stringify(body.profile, null, 2),
      "PETICION DEL USUARIO:", String(body.message || "").slice(0, 4000)
    ].join("\n\n");
    const response = await runProviderTask(providerId, {
      jobId: `profile_assist_${Date.now()}`,
      stage: "technical",
      prompt,
      mockResponse: {
        summary: "El simulador conserva el perfil sin cambios.", risks: [], proposedProfile: body.profile,
        testsToRun: ["Prueba determinista del contrato"]
      }
    });
    return NextResponse.json({ ok: true, proposal: safeJsonFromText(response.rawResponse), rawResponse: response.rawResponse });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
