import { NextResponse } from "next/server";

import { getLocalProcessingService } from "@web/lib/server-data";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await context.params;
  const record = getLocalProcessingService().getDocument(documentId);

  if (!record) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json(record);
}
