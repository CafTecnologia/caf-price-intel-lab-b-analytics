import { NextResponse } from "next/server";

import { LocalProcessingService } from "@ai-first-core/local-dev/local-processing-service";
import { ProviderHttpError } from "@ai-first-core/providers/shared/http";

import { getLocalProcessingService } from "@web/lib/server-data";
import { getActiveProviderDefaults } from "@web/lib/provider-settings";

function getString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A source file is required." }, { status: 400 });
    }

    const defaults = getActiveProviderDefaults();
    const bytes = Buffer.from(await file.arrayBuffer());
    const providerConfig = LocalProcessingService.defaultProviderConfig({
      detectOfficialBlock: {
        provider: defaults.provider,
        model: defaults.model,
      },
      extractItemsBatch: {
        provider: defaults.provider,
        model: defaults.model,
      },
      validateBatch: {
        provider: defaults.provider,
        model: defaults.model,
      },
      validateGlobal: {
        provider: defaults.provider,
        model: defaults.model,
      },
    });

    const batchSizeRaw = Number(getString(formData.get("batchSize")) || "10");
    const batchSize = Number.isFinite(batchSizeRaw) ? Math.max(1, Math.min(20, batchSizeRaw)) : 10;

    const record = await getLocalProcessingService().processUpload({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      providerConfig,
      processingOptions: {
        batch_size: batchSize,
        batch_retry_limit: 1,
        export_formats: ["json", "csv", "xlsx"],
        enable_ocr_fallback: false,
        allow_batch_reprocess: getString(formData.get("allowBatchReprocess")) !== "false",
      },
    });

    return NextResponse.json({ documentId: record.documentId });
  } catch (error) {
    const providerMessage =
      error instanceof ProviderHttpError &&
      error.responseBody &&
      typeof error.responseBody === "object" &&
      "error" in error.responseBody &&
      error.responseBody.error &&
      typeof error.responseBody.error === "object" &&
      "message" in error.responseBody.error &&
      typeof error.responseBody.error.message === "string"
        ? error.responseBody.error.message
        : null;

    return NextResponse.json(
      {
        error: providerMessage || (error instanceof Error ? error.message : "Unexpected processing error."),
      },
      { status: 500 },
    );
  }
}
