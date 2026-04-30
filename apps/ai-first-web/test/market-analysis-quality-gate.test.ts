import { describe, expect, it } from "vitest";

import {
  evaluateMarketAnalysisRunQuality,
  getUnresolvedFailedStages,
  type MarketAnalysisRunStatus,
} from "../lib/market-analysis-quality-gate";
import type { MarketAnalysisResult } from "../lib/market-analysis-schema";
import type { MarketAnalysisStageTrace } from "../lib/market-analysis-trace";

function stage(stageName: string, status: "completed" | "failed", retryCount = 0): MarketAnalysisStageTrace {
  return {
    run_id: "run-test",
    document_name: "fixture.xlsx",
    stage_name: stageName,
    prompt: null,
    raw_response: status === "completed" ? "{}" : null,
    parsed_json: status === "completed" ? {} : null,
    status,
    error_message: status === "failed" ? "boom" : null,
    started_at: `2026-04-30T10:00:0${retryCount}.000Z`,
    finished_at: `2026-04-30T10:00:0${retryCount + 1}.000Z`,
    duration_ms: 1000,
    retry_count: retryCount,
    model: "gemini-3.1-pro-preview",
  };
}

function result(rows = 1): MarketAnalysisResult {
  return {
    rows: Array.from({ length: rows }, (_, index) => ({
      "Ítem": String(index + 1),
      "Nombre o descripción": "Item demo",
      "Descripción o ficha técnica": "Ficha demo",
      Cant: "1",
      "Análisis de Ficha": "Abierta",
      "Fuente 1 (Precio)": "Proveedor A | COP 1000 | proveedor-a.com.co",
      "Fuente 2 (Precio)": "Proveedor B | COP 1100 | https://proveedor-b.com/item",
      "Fuente 3 (Precio)": "Proveedor C | COP 1200 | proveedor-c.com",
      "Costo Optimista": "",
      "Costo Moderado": "",
      "COSTO PONDERADO UNIT": "",
      "COSTO PONDERADO TOTAL": "",
      "PRECIO REFERENCIA (TECHO) UNIT": "1300",
      "Viabilidad / Margen": "",
      "Resumen de Fuentes y Observaciones": "",
    })),
    warnings: [],
    provider_notes: [],
  };
}

function resultWithSources(sources: Array<[string, string, string]>): MarketAnalysisResult {
  return {
    rows: sources.map(([source1, source2, source3], index) => ({
      "Ãtem": String(index + 1),
      "Nombre o descripciÃ³n": "Item demo",
      "DescripciÃ³n o ficha tÃ©cnica": "Ficha demo",
      Cant: "1",
      "AnÃ¡lisis de Ficha": "Abierta",
      "Fuente 1 (Precio)": source1,
      "Fuente 2 (Precio)": source2,
      "Fuente 3 (Precio)": source3,
      "Costo Optimista": "",
      "Costo Moderado": "",
      "COSTO PONDERADO UNIT": "",
      "COSTO PONDERADO TOTAL": "",
      "PRECIO REFERENCIA (TECHO) UNIT": "1300",
      "Viabilidad / Margen": "",
      "Resumen de Fuentes y Observaciones": "",
    })),
    warnings: [],
    provider_notes: [],
  };
}

function statusFor(stages: MarketAnalysisStageTrace[], finishReason: string | null = "STOP"): MarketAnalysisRunStatus {
  return evaluateMarketAnalysisRunQuality({
    result: result(),
    usage: { finishReason, grounded: true, groundingSources: [{ uri: "https://example.com" }] },
    stages,
  }).status;
}

describe("market analysis quality gate", () => {
  it("allows clean completed only when no unresolved internal failures remain", () => {
    expect(statusFor([stage("document_map", "completed"), stage("audit_pass", "completed")])).toBe("completed");
  });

  it("blocks clean completed when a required stage remains failed", () => {
    expect(statusFor([stage("document_map", "completed"), stage("audit_pass", "failed")])).toBe(
      "partial_review_required",
    );
  });

  it("allows clean completed after retry repairs the failed stage", () => {
    const stages = [stage("audit_pass", "failed", 0), stage("audit_pass", "completed", 1)];

    expect(getUnresolvedFailedStages(stages)).toHaveLength(0);
    expect(statusFor(stages)).toBe("completed");
  });

  it("does not treat direct file rejection as unresolved when direct text completed", () => {
    const stages = [stage("ia_direct_file_generate", "failed", 0), stage("ia_direct_text_generate", "completed", 1)];

    expect(getUnresolvedFailedStages(stages)).toHaveLength(0);
    expect(statusFor(stages)).toBe("completed");
  });

  it("degrades optional quality repairs to completed_with_warnings", () => {
    expect(statusFor([stage("repair_pass:quality_gap", "failed")])).toBe("completed_with_warnings");
  });

  it("degrades partial provider finish reason even when rows exist", () => {
    expect(statusFor([stage("final_result", "completed")], "partial")).toBe("partial_review_required");
  });

  it("fails when no rows are produced", () => {
    const gate = evaluateMarketAnalysisRunQuality({
      result: result(0),
      usage: { finishReason: "STOP" },
      stages: [stage("final_result", "completed")],
    });

    expect(gate.status).toBe("failed");
  });

  it("requires manual review when too many rows have no market source prices", () => {
    const gate = evaluateMarketAnalysisRunQuality({
      result: resultWithSources([
        ["N/D", "N/D", "N/D"],
        ["N/D", "N/D", "N/D"],
        ["Proveedor A | COP 1000 | proveedor-a.com", "Proveedor B | COP 1100 | proveedor-b.com", "Proveedor C | COP 1200 | proveedor-c.com"],
      ]),
      usage: { finishReason: "STOP", grounded: true, groundingSources: [{ uri: "https://example.com" }] },
      stages: [stage("final_result", "completed")],
    });

    expect(gate.status).toBe("partial_review_required");
    expect(gate.warnings.some((warning) => warning.includes("QUALITY_GATE_SOURCE_COVERAGE"))).toBe(true);
  });

  it("does not call ungrounded IA sources clean completed", () => {
    const gate = evaluateMarketAnalysisRunQuality({
      result: resultWithSources([["Proveedor A | COP 1000 | proveedor-a.com", "Proveedor B | COP 1100 | proveedor-b.com", "Proveedor C | COP 1200 | proveedor-c.com"]]),
      usage: { finishReason: "STOP", grounded: true, groundingSources: [] },
      stages: [stage("final_result", "completed")],
    });

    expect(gate.status).toBe("completed_with_warnings");
    expect(gate.warnings.some((warning) => warning.includes("QUALITY_GATE_GROUNDING_MISMATCH"))).toBe(true);
    expect(gate.warnings.some((warning) => warning.includes("QUALITY_GATE_GROUNDING_NOT_VERIFIED"))).toBe(true);
  });

  it("requires manual review when trace records are missing", () => {
    const gate = evaluateMarketAnalysisRunQuality({
      result: result(),
      usage: { finishReason: "STOP", grounded: true, groundingSources: [{ uri: "https://example.com" }] },
      stages: [],
    });

    expect(gate.status).toBe("partial_review_required");
    expect(gate.warnings.some((warning) => warning.includes("QUALITY_GATE_TRACE_MISSING"))).toBe(true);
  });

  it("requires manual review when an internal fallback warning is present", () => {
    const fallbackResult = result();
    fallbackResult.warnings = ["STAGED_PIPELINE_FALLBACK: se uso pipeline legacy"];

    const gate = evaluateMarketAnalysisRunQuality({
      result: fallbackResult,
      usage: { finishReason: "STOP", grounded: true, groundingSources: [{ uri: "https://example.com" }] },
      stages: [stage("final_result", "completed")],
    });

    expect(gate.status).toBe("partial_review_required");
    expect(gate.warnings.some((warning) => warning.includes("QUALITY_GATE_INTERNAL_FALLBACK"))).toBe(true);
  });

  it("requires manual review when IA reports incomplete item coverage", () => {
    const incomplete = resultWithSources([[
      "Proveedor A | COP 1000 | proveedor-a.com",
      "Proveedor B | COP 1100 | proveedor-b.com",
      "Proveedor C | COP 1200 | proveedor-c.com",
    ]]);
    incomplete.warnings = ["Solo se generaron 4 filas de 6 detectadas."];

    const gate = evaluateMarketAnalysisRunQuality({
      result: incomplete,
      usage: { finishReason: "STOP", grounded: true, groundingSources: [{ uri: "https://example.com" }] },
      stages: [stage("final_result", "completed")],
    });

    expect(gate.status).toBe("partial_review_required");
    expect(gate.warnings.some((warning) => warning.includes("QUALITY_GATE_INCOMPLETE_RESULT_WARNING"))).toBe(true);
  });

  it("requires manual review when most priced sources are not traceable", () => {
    const gate = evaluateMarketAnalysisRunQuality({
      result: resultWithSources([["Proveedor A | COP 1000", "Proveedor B | COP 1100", "Proveedor C | COP 1200"]]),
      usage: { finishReason: "STOP", grounded: true, groundingSources: [{ uri: "https://example.com" }] },
      stages: [stage("final_result", "completed")],
    });

    expect(gate.status).toBe("partial_review_required");
    expect(gate.warnings.some((warning) => warning.includes("QUALITY_GATE_SOURCE_TRACEABILITY"))).toBe(true);
  });
});
