import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { normalizePipelineFailure } from "@/lib/ai-failures";
import { getPublicGeminiConfig, getReviewAgentRuntimeConfig } from "@/lib/config";
import { callGemini } from "@/lib/gemini";
import { parseJsonFromModelText } from "@/lib/json";
import { callReviewAgentGemini } from "@/lib/review-agent-call";
import { findBestStage3ResultForRunContext } from "@/lib/run-history";
import { runGoogleUrlContextValidation } from "@/lib/stage3-google-url-context";
import { collectStage3SourceDomainEvidence, collectStage3SourceEvidence } from "@/lib/stage3-source-audit";
import {
  buildStage3SourceSupervisorEvidencePayload,
  buildStage3SourceSupervisorPrompt,
  summarizeStage3SourceSignalEvidence,
  toStage3SourceSignalEvidence
} from "@/lib/stage3-source-supervisor-contract";
import { buildStage3CoverageReport, missingItemsDetail, validateStage3AgainstInput } from "@/lib/stage3Review";

export const runtime = "nodejs";

const AGENT_REL = path.join("agents", "stage3-review.agent.md");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type RepairOutput = {
  json_reparado: unknown;
  notas?: string[];
};

function isRepairOutput(value: unknown): value is RepairOutput {
  if (!isRecord(value)) {
    return false;
  }
  return "json_reparado" in value;
}

export async function POST(request: Request) {
  const publicCfg = await getPublicGeminiConfig();
  if (!publicCfg.enableStage3ReviewTools) {
    return NextResponse.json(
      { error: "Herramientas de revisión Etapa 3 desactivadas (ENABLE_STAGE3_REVIEW_TOOLS)." },
      { status: 404 }
    );
  }

  let body: {
    action?: string;
    stage2Json?: unknown;
    stage3Result?: unknown;
    rawText?: string;
    runId?: string;
    maxSources?: number;
    evidence?: unknown;
    urlContextResult?: unknown;
    model?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const action = body.action;

  if (action === "probe") {
    const reviewCfg = await getReviewAgentRuntimeConfig();
    if (!reviewCfg) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Configura REVIEW_MODEL y la API key del proveedor en configuración (sandbox reparación Etapa 3)."
        },
        { status: 400 }
      );
    }

    const started = Date.now();
    const probePrompt = `Respondé únicamente con este objeto JSON válido, sin markdown ni texto extra:
{"probe_ok":true,"agent":"stage3-review"}`;

    try {
      const ai = await callReviewAgentGemini(probePrompt, reviewCfg);
      let parseOk = false;
      try {
        const parsed = parseJsonFromModelText(ai.text);
        parseOk =
          typeof parsed === "object" &&
          parsed !== null &&
          (parsed as Record<string, unknown>).probe_ok === true;
      } catch {
        parseOk = false;
      }

      return NextResponse.json({
        ok: true,
        latencyMs: Date.now() - started,
        provider: ai.provider,
        model: ai.model,
        congestionRetries: ai.congestionRetries ?? 0,
        responseSnippet: ai.text.slice(0, 1200),
        jsonMatchesProbeShape: parseOk
      });
    } catch (error) {
      const pf = normalizePipelineFailure(error, "stage3");
      return NextResponse.json(
        {
          ok: false,
          latencyMs: Date.now() - started,
          code: pf.code,
          error: pf.userMessage,
          diagnostic: pf.technicalMessage,
          userAction: pf.userAction,
          details: pf.details,
          raw: pf.raw
        },
        { status: pf.httpStatus >= 400 && pf.httpStatus < 600 ? pf.httpStatus : 502 }
      );
    }
  }

  if (action === "validate") {
    const report = validateStage3AgainstInput(body.stage2Json, body.stage3Result);
    return NextResponse.json({ ok: true, report });
  }

  if (action === "missing") {
    const detail = missingItemsDetail(body.stage2Json, body.stage3Result);
    return NextResponse.json({ ok: true, ...detail });
  }

  if (action === "domainEvidence") {
    if (!body.stage3Result) {
      return NextResponse.json({ error: "Falta stage3Result para revisar dominios." }, { status: 400 });
    }

    try {
      const result = await collectStage3SourceDomainEvidence(body.stage3Result, { maxSources: body.maxSources });
      const evidence = toStage3SourceSignalEvidence(result.evidence);
      return NextResponse.json({
        ok: true,
        summary: {
          totalSourcesFound: result.summary.totalSourcesFound,
          inspectedSources: result.summary.inspectedSources,
          binarySignals: summarizeStage3SourceSignalEvidence(evidence)
        },
        evidence
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        { ok: false, error: "No se pudo revisar dominios de fuentes.", diagnostic: message },
        { status: 502 }
      );
    }
  }

  if (action === "linkEvidence") {
    if (!body.stage3Result) {
      return NextResponse.json({ error: "Falta stage3Result para extraer evidencia." }, { status: 400 });
    }

    try {
      const result = await collectStage3SourceEvidence(body.stage3Result, { maxSources: body.maxSources });
      const evidence = toStage3SourceSignalEvidence(result.evidence);
      return NextResponse.json({
        ok: true,
        summary: {
          totalSourcesFound: result.summary.totalSourcesFound,
          inspectedSources: result.summary.inspectedSources,
          binarySignals: summarizeStage3SourceSignalEvidence(evidence)
        },
        evidence
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        { ok: false, error: "No se pudo extraer evidencia de links.", diagnostic: message },
        { status: 502 }
      );
    }
  }


  if (action === "googleUrlContext") {
    if (!body.stage3Result) {
      return NextResponse.json({ error: "Falta stage3Result para validar URLs con Google URL Context." }, { status: 400 });
    }

    try {
      const result = await runGoogleUrlContextValidation({
        stage3Result: body.stage3Result,
        model: typeof body.model === "string" ? body.model : undefined,
        maxSources: body.maxSources,
        runId: typeof body.runId === "string" ? body.runId : undefined
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      const pf = normalizePipelineFailure(error, "stage3");
      return NextResponse.json(
        {
          ok: false,
          error: pf.userMessage,
          diagnostic: pf.technicalMessage,
          code: pf.code,
          userAction: pf.userAction,
          details: pf.details,
          raw: pf.raw
        },
        { status: pf.httpStatus >= 400 && pf.httpStatus < 600 ? pf.httpStatus : 502 }
      );
    }
  }

  if (action === "sourceSupervisor") {
    if (!body.stage3Result && !Array.isArray(body.evidence)) {
      return NextResponse.json(
        { error: "Falta stage3Result o evidence para auditoria de fuentes." },
        { status: 400 }
      );
    }

    const evidencePayload = await buildStage3SourceSupervisorEvidencePayload(body);

    const model = typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "deepseek:deepseek-v4-pro";

    const prompt = buildStage3SourceSupervisorPrompt(evidencePayload);

    try {
      const ai = await callGemini({ prompt, model, stage: "stage3" });
      let supervision: unknown;
      try {
        supervision = parseJsonFromModelText(ai.text);
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: "El supervisor IA no devolvio JSON valido.",
            model: ai.model,
            provider: ai.provider,
            rawPreview: ai.text.slice(0, 12000)
          },
          { status: 422 }
        );
      }

      return NextResponse.json({
        ok: true,
        model: ai.model,
        provider: ai.provider,
        evidence: evidencePayload.evidence,
        evidenceSummary: evidencePayload.summary,
        supervision,
        rawPreview: ai.text.slice(0, 12000)
      });
    } catch (error) {
      const pf = normalizePipelineFailure(error, "stage3");
      return NextResponse.json(
        {
          ok: false,
          error: pf.userMessage,
          diagnostic: pf.technicalMessage,
          code: pf.code,
          userAction: pf.userAction,
          details: pf.details,
          raw: pf.raw
        },
        { status: pf.httpStatus >= 400 && pf.httpStatus < 600 ? pf.httpStatus : 502 }
      );
    }
  }


  if (action === "history") {
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "Falta runId para revisar historial." }, { status: 400 });
    }
    const best = findBestStage3ResultForRunContext({
      runId: body.runId.trim(),
      stage2Result: body.stage2Json
    });
    const currentCoverage = body.stage2Json && body.stage3Result
      ? buildStage3CoverageReport(body.stage2Json, body.stage3Result)
      : null;
    const bestCoverage = best?.result && body.stage2Json
      ? buildStage3CoverageReport(body.stage2Json, best.result)
      : null;

    return NextResponse.json({
      ok: true,
      best,
      currentCoverage,
      bestCoverage,
      recommendation: best && currentCoverage && best.actualCount > currentCoverage.actualCount
        ? "Existe un resultado historico mejor para esta corrida/proyecto."
        : "No se encontro un resultado historico mejor que el actual."
    });
  }

  if (action === "repair") {
    const raw =
      typeof body.rawText === "string" && body.rawText.trim()
        ? body.rawText.trim()
        : body.stage3Result !== undefined
          ? JSON.stringify(body.stage3Result, null, 2)
          : "";

    if (!raw) {
      return NextResponse.json(
        { error: "Falta texto JSON (rawText o stage3Result)." },
        { status: 400 }
      );
    }

    const reviewCfg = await getReviewAgentRuntimeConfig();
    if (!reviewCfg) {
      return NextResponse.json(
        {
          error:
            "Configura REVIEW_MODEL y la API key del proveedor en configuración (sandbox reparación Etapa 3)."
        },
        { status: 400 }
      );
    }

    let agentMd: string;
    try {
      agentMd = await readFile(path.join(process.cwd(), AGENT_REL), "utf8");
    } catch {
      agentMd =
        "Repara solo sintaxis JSON del resultado Etapa 3. No inventes fuentes, precios ni URLs. Salida: {json_reparado, notas}.";
    }

    const prompt = `${agentMd}

---

Texto o JSON a reparar (no inventes datos comerciales):

${raw}

Recuerda: responde solo con un objeto JSON {"json_reparado": ... , "notas": [] } sin markdown.
`;

    try {
      const ai = await callReviewAgentGemini(prompt, reviewCfg);

      let parsed: unknown;
      try {
        parsed = parseJsonFromModelText(ai.text);
      } catch {
        return NextResponse.json(
          {
            error: "El modelo no devolvió JSON válido.",
            rawPreview: ai.text.slice(0, 12000),
            model: ai.model
          },
          { status: 422 }
        );
      }

      if (!isRepairOutput(parsed)) {
        return NextResponse.json(
          {
            error: "La respuesta no incluye json_reparado.",
            rawPreview: ai.text.slice(0, 12000),
            model: ai.model
          },
          { status: 422 }
        );
      }

      return NextResponse.json({
        ok: true,
        json_reparado: parsed.json_reparado,
        notas: Array.isArray(parsed.notas) ? parsed.notas : [],
        model: ai.model,
        provider: ai.provider
      });
    } catch (error) {
      const pf = normalizePipelineFailure(error, "stage3");
      return NextResponse.json(
        {
          error: pf.userMessage,
          diagnostic: pf.technicalMessage,
          code: pf.code,
          userAction: pf.userAction,
          details: pf.details,
          raw: pf.raw
        },
        { status: pf.httpStatus >= 400 && pf.httpStatus < 600 ? pf.httpStatus : 502 }
      );
    }
  }

  return NextResponse.json({ error: "Accion no valida. Use validate, missing, history, domainEvidence, linkEvidence, sourceSupervisor, repair o probe." }, { status: 400 });
}
