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
      "Fuente 1 (Precio)": "Proveedor A | COP 1000",
      "Fuente 2 (Precio)": "Proveedor B | COP 1100",
      "Fuente 3 (Precio)": "Proveedor C | COP 1200",
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
    usage: { finishReason },
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
});
