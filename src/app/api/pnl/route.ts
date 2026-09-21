import { NextRequest, NextResponse } from "next/server";
import { buildReport, buildCustomSlice } from "@/lib/pnl";

// Rapport P&L en JSON (toutes périodes pré-calculées). Ex: /api/pnl
// Période perso : /api/pnl?from=2026-09-01&to=2026-09-15 -> renvoie { slice }.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const from = req.nextUrl.searchParams.get("from");
    const to = req.nextUrl.searchParams.get("to");
    if (from && to) {
      if (!DAY_RE.test(from) || !DAY_RE.test(to)) {
        return NextResponse.json({ error: "Dates invalides (format YYYY-MM-DD)" }, { status: 400 });
      }
      const slice = await buildCustomSlice(from, to);
      return NextResponse.json({ slice });
    }
    const report = await buildReport();
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
