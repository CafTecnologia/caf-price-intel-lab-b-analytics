import { NextResponse } from "next/server";
import { listRuns } from "@/lib/run-history";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? 50);
  return NextResponse.json({ runs: listRuns(Number.isFinite(limit) ? limit : 50) });
}
