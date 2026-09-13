import { NextResponse } from "next/server";
import { buildReport } from "@/lib/pnl";

// Rapport P&L en JSON (toutes périodes pré-calculées). Ex: /api/pnl
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const report = await buildReport();
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
