import { NextResponse } from "next/server";
import { PROVIDERS, providerHealth } from "@/lib/providers";

export async function GET() {
  const health = await Promise.all(PROVIDERS.map((entry) => providerHealth(entry.id)));
  return NextResponse.json({ ok: true, providers: health });
}
