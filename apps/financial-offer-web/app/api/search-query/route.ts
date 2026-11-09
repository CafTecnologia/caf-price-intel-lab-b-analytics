import { NextResponse } from "next/server";

import { readAppAiConfig } from "@offer/lib/app-config";
import { buildSearchQueryWithDeepSeek, type SearchAssistantItem } from "@offer/lib/search-assistant";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SearchAssistantItem;
    const result = await buildSearchQueryWithDeepSeek(body, await readAppAiConfig());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo preparar la busqueda.",
        code: "SEARCH_QUERY_FAILED",
      },
      { status: 400 },
    );
  }
}
