import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authEnabled, makeToken, passwordMatches } from "@/lib/auth";

export const dynamic = "force-dynamic";

const COOKIE_OPTS = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 30, // 30 jours
};

// POST { password } -> connexion ; POST { action: "logout" } -> déconnexion.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { password?: string; action?: string };

  if (body.action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
    return res;
  }

  if (!authEnabled()) return NextResponse.json({ ok: true, disabled: true });

  if (await passwordMatches(String(body.password ?? ""))) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE, await makeToken(), COOKIE_OPTS);
    return res;
  }
  return NextResponse.json({ ok: false, error: "Mot de passe incorrect" }, { status: 401 });
}

// GET -> déconnexion via simple lien, puis redirection vers /login.
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(AUTH_COOKIE, "", { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}
