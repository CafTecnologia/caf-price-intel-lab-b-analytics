import { NextResponse } from "next/server";
import { listWorkProfileTestCases } from "@/lib/work-profile-test-cases";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, cases: await listWorkProfileTestCases() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error), cases: [] }, { status: 500 });
  }
}
