import { NextRequest, NextResponse } from "next/server";
import { clientIp, isAllowedIp } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Renvoie l'IP publique du visiteur (pour l'ajouter à ALLOWED_IPS).
export function GET(req: NextRequest) {
  const ip = clientIp(req.ip, req.headers.get("x-forwarded-for"));
  return NextResponse.json({ ip, trusted: isAllowedIp(ip) });
}
