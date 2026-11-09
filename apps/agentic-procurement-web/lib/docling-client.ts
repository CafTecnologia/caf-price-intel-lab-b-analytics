export type DoclingConversion = {
  markdown: string;
  text: string;
  status: string;
  processingTime: number;
  warnings: string[];
};

export type DoclingClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  doOcr?: boolean;
  tableMode?: "fast" | "accurate";
  async?: boolean;
  doTableStructure?: boolean;
  includeImages?: boolean;
  imagesScale?: number;
  ocrPreset?: string;
  ocrLanguages?: string[];
  documentTimeout?: number;
  pageRange?: [number, number];
};

export async function doclingHealth(options: DoclingClientOptions = {}) {
  const baseUrl = doclingBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      headers: apiHeaders(options.apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    });
    return { ok: response.ok, status: response.status, baseUrl };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      baseUrl,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function convertWithDocling(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  options: DoclingClientOptions = {}
): Promise<DoclingConversion> {
  const cachePath = conversionCachePath(fileName, mimeType, buffer, options);
  if (cachePath) {
    const cached = await readCachedConversion(cachePath);
    if (cached) return cached;
  }
  const conversion = options.async === false || (options.async === undefined && (Boolean(options.pageRange) || process.env.DOCLING_USE_SYNC === "true"))
    ? await convertSync(fileName, mimeType, buffer, options)
    : await convertAsync(fileName, mimeType, buffer, options);
  if (cachePath) await writeCachedConversion(cachePath, conversion);
  return conversion;
}

async function convertAsync(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  options: DoclingClientOptions
): Promise<DoclingConversion> {
  const baseUrl = doclingBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${baseUrl}/v1/convert/file/async`, {
    method: "POST",
    headers: apiHeaders(options.apiKey),
    body: conversionForm(fileName, mimeType, buffer, options),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000)
  });
  const submission = await jsonResponse(response, `Docling no pudo encolar ${fileName}`);
  const taskId = String(submission.task_id || "");
  if (!response.ok || !taskId) {
    throw new Error(`Docling no pudo encolar ${fileName}: ${detailFromPayload(submission)}.`);
  }

  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const poll = await fetchImpl(`${baseUrl}/v1/status/poll/${encodeURIComponent(taskId)}?wait=10`, {
      headers: apiHeaders(options.apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000)
    });
    const statusPayload = await jsonResponse(poll, `Docling no pudo consultar ${fileName}`);
    const status = String(statusPayload.task_status || "");
    if (["failure", "skipped"].includes(status)) {
      throw new Error(`Docling termino ${fileName} con estado ${status}: ${detailFromPayload(statusPayload)}.`);
    }
    if (["success", "partial_success"].includes(status)) {
      const resultResponse = await fetchImpl(`${baseUrl}/v1/result/${encodeURIComponent(taskId)}`, {
        headers: apiHeaders(options.apiKey),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000)
      });
      const payload = await jsonResponse(resultResponse, `Docling no pudo recuperar ${fileName}`);
      return conversionFromPayload(fileName, resultResponse.status, payload);
    }
  }
  throw new Error(`Docling excedio 20 minutos procesando ${fileName}; la tarea ${taskId} queda trazable en el servicio.`);
}

async function convertSync(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  options: DoclingClientOptions
): Promise<DoclingConversion> {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${doclingBaseUrl(options.baseUrl)}/v1/convert/file`, {
    method: "POST",
    headers: apiHeaders(options.apiKey),
    body: conversionForm(fileName, mimeType, buffer, options),
    cache: "no-store",
    signal: AbortSignal.timeout(12 * 60 * 1000)
  });
  const payload = await jsonResponse(response, `Docling no pudo convertir ${fileName}`);
  return conversionFromPayload(fileName, response.status, payload);
}

function conversionForm(fileName: string, mimeType: string, buffer: Buffer, options: DoclingClientOptions) {
  const form = new FormData();
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  form.append("files", new Blob([bytes], { type: mimeType || "application/octet-stream" }), fileName);
  form.append("to_formats", "md");
  form.append("to_formats", "text");
  form.append("do_ocr", String(options.doOcr ?? true));
  if (options.ocrPreset) form.append("ocr_preset", options.ocrPreset);
  for (const language of options.ocrLanguages ?? ["es", "en"]) form.append("ocr_lang", language);
  for (const page of options.pageRange || []) form.append("page_range", String(page));
  form.append("table_mode", options.tableMode || "accurate");
  form.append("do_table_structure", String(options.doTableStructure ?? true));
  form.append("include_images", String(options.includeImages ?? false));
  form.append("images_scale", String(options.imagesScale ?? 1));
  if (options.documentTimeout !== undefined) form.append("document_timeout", String(options.documentTimeout));
  form.append("image_export_mode", "placeholder");
  form.append("abort_on_error", "false");
  return form;
}

function conversionFromPayload(fileName: string, responseStatus: number, payload: Record<string, unknown>) {
  if (responseStatus < 200 || responseStatus >= 300) {
    throw new Error(`Docling no pudo convertir ${fileName}: ${detailFromPayload(payload)}`);
  }
  const document = isRecord(payload.document) ? payload.document : {};
  const errors = Array.isArray(payload.errors) ? payload.errors.map((entry) => stringify(entry)) : [];
  const status = String(payload.status || "unknown");
  if (!["success", "partial_success"].includes(status)) {
    throw new Error(`Docling termino ${fileName} con estado ${status}: ${errors.join("; ") || "sin detalle"}.`);
  }
  return {
    markdown: String(document.md_content || ""),
    text: String(document.text_content || ""),
    status,
    processingTime: Number(payload.processing_time || 0),
    warnings: errors
  };
}

async function jsonResponse(response: Response, context: string) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`${context}: HTTP ${response.status} sin JSON valido (${raw.slice(0, 300)}).`);
  }
}

function detailFromPayload(payload: Record<string, unknown>) {
  return String(payload.error_message || payload.detail || payload.message || "sin detalle");
}

function doclingBaseUrl(value?: string) {
  return String(value || process.env.DOCLING_SERVICE_URL || "http://127.0.0.1:5001").replace(/\/+$/, "");
}

function apiHeaders(value?: string): Record<string, string> {
  const key = value || process.env.DOCLING_SERVICE_API_KEY || "";
  return key ? { "X-Api-Key": key } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringify(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function conversionCachePath(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  options: DoclingClientOptions
) {
  if (process.env.DOCLING_CACHE === "false" || (options.fetchImpl && !process.env.DOCLING_CACHE_DIR)) return "";
  const cacheDir = process.env.DOCLING_CACHE_DIR || path.join(process.cwd(), ".data", "document-cache");
  const checksum = createHash("sha256")
    .update("docling-v3-unified-options")
    .update(JSON.stringify({ baseUrl: doclingBaseUrl(options.baseUrl), doOcr: options.doOcr ?? true, tableMode: options.tableMode || "accurate", doTableStructure: options.doTableStructure ?? true, includeImages: options.includeImages ?? false, imagesScale: options.imagesScale ?? 1, ocrPreset: options.ocrPreset || "", ocrLanguages: options.ocrLanguages ?? ["es", "en"], documentTimeout: options.documentTimeout ?? null, pageRange: options.pageRange ?? null }))
    .update(fileName)
    .update(mimeType)
    .update(buffer)
    .digest("hex");
  return path.join(cacheDir, `${checksum}.json`);
}

async function readCachedConversion(cachePath: string) {
  try {
    const value = JSON.parse(await fs.readFile(cachePath, "utf8")) as DoclingConversion;
    return value?.status && typeof value.markdown === "string" ? value : null;
  } catch {
    return null;
  }
}

async function writeCachedConversion(cachePath: string, conversion: DoclingConversion) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(conversion));
  await fs.rename(temporary, cachePath);
}
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
