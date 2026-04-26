import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";

import { Parser as Json2CsvParser } from "json2csv";

import type { FileType } from "@ai-first-contracts/enums";
import { segmentDocumentFromFile } from "@ai-first-core/document/document-segmenter";

import { buildInitialOfferControls, buildOfferSimulation, toOfferExportRows } from "./financial-simulation";
import { buildMarketAnalysisPrompt, MARKET_ANALYSIS_PROMPT_VERSION } from "./market-analysis-prompt";
import { runMarketAnalysisProvider } from "./market-analysis-provider";
import { MARKET_ANALYSIS_COLUMNS, normalizeMarketAnalysisRow } from "./market-analysis-schema";
import { getActiveProviderConnectionForServer } from "./provider-settings";
import { MarketAnalysisStore, type MarketAnalysisRun } from "./market-analysis-store";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

function projectRoot(): string {
  const cwd = process.cwd();
  return /[\\/]apps[\\/]ai-first-web$/.test(cwd) ? resolve(cwd, "..", "..") : cwd;
}

function uploadsRoot(): string {
  return resolve(projectRoot(), "data", "ai-first-local", "market-analysis-uploads");
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function normalizeFileType(fileName: string, mimeType: string): FileType {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (extension === ".xlsx" || mimeType.includes("spreadsheetml")) {
    return "xlsx";
  }
  if (extension === ".xls" || mimeType.includes("ms-excel")) {
    return "xls";
  }
  if (extension === ".docx" || mimeType.includes("wordprocessingml")) {
    return "docx";
  }
  if (extension === ".doc" || mimeType.includes("msword")) {
    return "doc";
  }

  throw new Error(`Tipo de archivo no soportado: ${fileName}`);
}

function buildChecksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function buildDocumentText(segments: Awaited<ReturnType<typeof segmentDocumentFromFile>>): string {
  return segments
    .map((segment) => {
      const location = [
        segment.locator.sheet ? `sheet=${segment.locator.sheet}` : null,
        segment.locator.page ? `page=${segment.locator.page}` : null,
        segment.locator.row_start ? `row=${segment.locator.row_start}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      return `--- segment_id=${segment.segment_id}${location ? ` (${location})` : ""} ---\n${segment.raw_text}`;
    })
    .join("\n\n")
    .slice(0, 180_000);
}

function buildSourceSummary(segments: Awaited<ReturnType<typeof segmentDocumentFromFile>>): string {
  const sheets = Array.from(new Set(segments.map((segment) => segment.locator.sheet).filter(Boolean)));
  const rowCount = segments.filter((segment) => segment.unit_type === "table_row_range").length;

  return [
    `Segmentos extraídos localmente: ${segments.length}`,
    rowCount > 0 ? `Filas de tabla detectadas: ${rowCount}` : null,
    sheets.length > 0 ? `Hojas detectadas: ${sheets.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function createMockResult(documentText: string) {
  const rows = documentText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return normalizeMarketAnalysisRow({
        "Ítem": cells[0] ?? "",
        "Nombre o descripción": cells[1] ?? "",
        "Descripción o ficha técnica": cells[1] ?? "",
        "Cant": "",
        "Análisis de Ficha": "Pendiente de análisis con IA real.",
        "Fuente 1 (Precio)": "N/D",
        "Fuente 2 (Precio)": "N/D",
        "Fuente 3 (Precio)": "N/D",
        "Costo Optimista": "N/D",
        "Costo Moderado": "N/D",
        "COSTO PONDERADO UNIT": "N/D",
        "COSTO PONDERADO TOTAL": "N/D",
        "PRECIO REFERENCIA (TECHO) UNIT": cells[cells.length - 1] ?? "",
        "Viabilidad / Margen": "N/D",
        "Resumen de Fuentes y Observaciones": "Mock local: no se consultaron fuentes de mercado.",
      });
    });

  return {
    rows,
    warnings: ["Resultado generado en modo mock local; no contiene benchmarking real."],
    provider_notes: ["Configura una API con crédito disponible para análisis comercial real."],
  };
}

export class MarketAnalysisService {
  constructor(
    private readonly store = new MarketAnalysisStore(),
    private readonly uploadsDirectory = uploadsRoot(),
  ) {}

  async processUpload(request: { fileName: string; mimeType: string; bytes: Buffer }): Promise<MarketAnalysisRun> {
    const runId = randomUUID();
    const fileType = normalizeFileType(request.fileName, request.mimeType);
    const uploadDirectory = resolve(this.uploadsDirectory, runId);
    await mkdir(uploadDirectory, { recursive: true });
    const uploadedFilePath = resolve(uploadDirectory, request.fileName);
    await writeFile(uploadedFilePath, request.bytes);

    const segments = await segmentDocumentFromFile({
      documentId: runId,
      filePath: uploadedFilePath,
      fileType,
    });
    const sourceSummary = buildSourceSummary(segments);
    const documentText = buildDocumentText(segments);
    const providerConnection = getActiveProviderConnectionForServer();
    const prompt = buildMarketAnalysisPrompt({
      fileName: request.fileName,
      fileType,
      sourceSummary,
      documentText,
    });

    const startedAt = toIsoNow();
    try {
      const providerOutput =
        process.env.AI_FIRST_FORCE_MARKET_MOCK === "true" || process.env.AI_FIRST_FORCE_MOCK === "1"
          ? {
              result: createMockResult(documentText),
              usage: {
                provider: providerConnection.provider,
                model: providerConnection.model,
                latencyMs: 0,
                inputTokens: null,
                outputTokens: null,
                finishReason: "mock",
                grounded: false,
                groundingSources: [],
              },
            }
          : await runMarketAnalysisProvider({
              provider: providerConnection.provider,
              model: providerConnection.model,
              baseUrl: providerConnection.baseUrl,
              apiKey: providerConnection.apiKey,
              prompt,
            });

      return this.store.save({
        runId,
        fileName: request.fileName,
        fileType,
        status: "completed",
        createdAt: startedAt,
        updatedAt: toIsoNow(),
        provider: providerConnection.provider,
        model: providerConnection.model,
        promptVersion: MARKET_ANALYSIS_PROMPT_VERSION,
        rowCount: providerOutput.result.rows.length,
        uploadedFilePath,
        sourceSummary: `${sourceSummary}\nSHA256: ${buildChecksum(request.bytes)}`,
        result: {
          rows: providerOutput.result.rows.map((row) => normalizeMarketAnalysisRow(row)),
          warnings: providerOutput.result.warnings,
          provider_notes: providerOutput.result.provider_notes,
        },
        groundingSources: providerOutput.usage.groundingSources,
        usage: {
          latencyMs: providerOutput.usage.latencyMs,
          inputTokens: providerOutput.usage.inputTokens,
          outputTokens: providerOutput.usage.outputTokens,
          finishReason: providerOutput.usage.finishReason,
          grounded: providerOutput.usage.grounded,
        },
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado procesando el análisis de mercado.";
      const failedRun = this.store.save({
        runId,
        fileName: request.fileName,
        fileType,
        status: "failed",
        createdAt: startedAt,
        updatedAt: toIsoNow(),
        provider: providerConnection.provider,
        model: providerConnection.model,
        promptVersion: MARKET_ANALYSIS_PROMPT_VERSION,
        rowCount: 0,
        uploadedFilePath,
        sourceSummary: `${sourceSummary}\nSHA256: ${buildChecksum(request.bytes)}`,
        result: {
          rows: [],
          warnings: [message],
          provider_notes: [],
        },
        groundingSources: [],
        usage: null,
        errorMessage: message,
      });

      throw Object.assign(new Error(message), { runId: failedRun.runId });
    }
  }

  getRun(runId: string): MarketAnalysisRun | null {
    return this.store.get(runId);
  }

  listRuns(limit = 8): MarketAnalysisRun[] {
    return this.store.list(limit);
  }

  exportRun(runId: string, format: "json" | "csv" | "xlsx", view: "market" | "financial" = "market") {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`No existe el análisis: ${runId}`);
    }

    if (view === "financial") {
      const simulation = buildOfferSimulation(run.result.rows, buildInitialOfferControls(run.result.rows));
      const exportRows = toOfferExportRows(simulation);

      if (format === "json") {
        return {
          fileName: `${run.fileName}.financial-simulation.json`,
          mimeType: "application/json",
          body: Buffer.from(JSON.stringify({ summary: simulation.summary, rows: exportRows }, null, 2), "utf8"),
        };
      }

      if (format === "csv") {
        const parser = new Json2CsvParser({
          fields: [
            "item",
            "description",
            "unit",
            "quantity",
            "costUnit",
            "referenceUnit",
            "referenceTotal",
            "costTotal",
            "costVsReferencePct",
            "maxProfitPctBeforeCeiling",
            "selectedProfitPct",
            "offerUnit",
            "offerTotal",
            "ceilingOk",
            "discountPctVsReference",
            "status",
            "warnings",
            "sourceNotes",
          ],
        });
        return {
          fileName: `${run.fileName}.financial-simulation.csv`,
          mimeType: "text/csv; charset=utf-8",
          body: Buffer.from(parser.parse(exportRows), "utf8"),
        };
      }

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Oferta");
      const body = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      }) as Buffer;

      return {
        fileName: `${run.fileName}.financial-simulation.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body,
      };
    }

    if (format === "json") {
      return {
        fileName: `${run.fileName}.market-analysis.json`,
        mimeType: "application/json",
        body: Buffer.from(JSON.stringify(run.result, null, 2), "utf8"),
      };
    }

    if (format === "csv") {
      const parser = new Json2CsvParser({ fields: [...MARKET_ANALYSIS_COLUMNS] });
      return {
        fileName: `${run.fileName}.market-analysis.csv`,
        mimeType: "text/csv; charset=utf-8",
        body: Buffer.from(parser.parse(run.result.rows), "utf8"),
      };
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(run.result.rows, {
      header: [...MARKET_ANALYSIS_COLUMNS],
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, "Matriz");
    const body = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    return {
      fileName: `${run.fileName}.market-analysis.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body,
    };
  }
}

let singleton: MarketAnalysisService | null = null;

export function getMarketAnalysisService() {
  singleton ??= new MarketAnalysisService();
  return singleton;
}
