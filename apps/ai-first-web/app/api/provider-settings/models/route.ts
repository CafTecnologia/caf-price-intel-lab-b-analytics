import { NextResponse } from "next/server";

import { AI_PROVIDERS, type AiProvider } from "@ai-first-contracts/enums";

import { discoverProviderModels } from "@web/lib/provider-model-discovery";

function isProvider(value: string | null): value is AiProvider {
  return Boolean(value && (AI_PROVIDERS as readonly string[]).includes(value));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");

  if (!isProvider(provider)) {
    return NextResponse.json({ error: "Provider invalido." }, { status: 400 });
  }

  const result = await discoverProviderModels(provider);
  return NextResponse.json(result);
}
