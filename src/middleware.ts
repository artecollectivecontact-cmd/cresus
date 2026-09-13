import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authEnabled, clientIp, isAllowedIp, verifyToken } from "@/lib/auth";

// Protège toutes les routes (pages + API) quand APP_PASSWORD est défini.
// Laisse passer la page de login, l'API de login, l'API d'IP et les assets.

const PUBLIC_PATHS = ["/login", "/api/login", "/api/ip"];

export async function middleware(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // IP de confiance : accès direct sans mot de passe.
  const ip = clientIp(req.ip, req.headers.get("x-forwarded-for"));
  if (isAllowedIp(ip)) return NextResponse.next();

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (await verifyToken(token)) return NextResponse.next();

  // API : 401 JSON. Pages : redirection vers /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Tout sauf les assets Next et quelques fichiers publics.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
