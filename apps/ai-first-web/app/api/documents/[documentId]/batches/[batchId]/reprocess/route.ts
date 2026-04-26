import { NextResponse } from "next/server";

import { getLocalProcessingService } from "@web/lib/server-data";
import { resolveSavedModel } from "@web/lib/provider-settings";

export async function POST(request: Request, context: { params: Promise<{ documentId: string; batchId: string }> }) {
  try {
    const { documentId, batchId } = await context.params;
    const payload = (await request.json().catch(() => ({}))) as {
      extractProvider?: "openai" | "gemini" | "anthropic" | "deepseek";
      extractModel?: string;
      validateProvider?: "openai" | "gemini" | "anthropic" | "deepseek";
      validateModel?: string;
    };

    const record = await getLocalProcessingService().reprocessBatch({
      documentId,
      batchId,
      override: {
        extractItemsBatch: payload.extractProvider
          ? {
              provider: payload.extractProvider,
              model: resolveSavedModel(payload.extractProvider, payload.extractModel),
            }
          : undefined,
        validateBatch: payload.validateProvider
          ? {
              provider: payload.validateProvider,
              model: resolveSavedModel(payload.validateProvider, payload.validateModel),
            }
          : undefined,
      },
    });

    return NextResponse.json({
      documentId: record.documentId,
      processingStatus: record.processingStatus,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected batch reprocess error." },
      { status: 500 },
    );
  }
}
