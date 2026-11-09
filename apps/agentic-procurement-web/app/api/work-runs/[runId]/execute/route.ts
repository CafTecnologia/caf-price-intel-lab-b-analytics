import { NextResponse } from "next/server";
import { executeWorkProfileRun } from "@/lib/work-profile-runtime";
import { publicRun } from "@/lib/work-profile-serialize";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function POST(_: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    return NextResponse.json({ ok: true, run: publicRun(await executeWorkProfileRun(runId)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

