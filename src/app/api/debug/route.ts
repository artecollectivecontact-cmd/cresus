import { NextResponse } from "next/server";
import { debugSample } from "@/lib/pnl";

// Diagnostic : échantillon des références/pays pour comprendre le rattachement
// des coûts POD par région. Protégé par le mot de passe (middleware).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    return NextResponse.json(await debugSample());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
