import { NextResponse } from "next/server";

import { getLocalProcessingService } from "@web/lib/server-data";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") ?? "json") as "json" | "csv" | "xlsx";
    const exportResult = getLocalProcessingService().exportDocument(documentId, format);

    return new NextResponse(new Uint8Array(exportResult.body), {
      headers: {
        "content-type": exportResult.mimeType,
        "content-disposition": `attachment; filename="${exportResult.fileName}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected export error." },
      { status: 500 },
    );
  }
}
