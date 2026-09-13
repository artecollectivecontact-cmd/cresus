import { NextRequest, NextResponse } from "next/server";
import { buildReport } from "@/lib/pnl";

// Rapport P&L en JSON. Ex: /api/pnl?days=14&focusDay=2026-09-13
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get("days") ?? 14);
  const focusDay = searchParams.get("focusDay") ?? undefined;
  try {
    const report = await buildReport({
      days: Number.isFinite(days) ? Math.min(Math.max(days, 1), 90) : 14,
      focusDay: focusDay || undefined,
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
