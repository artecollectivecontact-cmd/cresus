// ---------------------------------------------------------------------------
// Protection par mot de passe de tout le site.
//
// Activée dès que la variable d'env APP_PASSWORD est définie (sur Vercel).
// Si APP_PASSWORD est absente, le site reste ouvert (utile en démo / dev).
//
// Le cookie ne contient PAS le mot de passe : il stocke un jeton = HMAC-SHA256
// d'un message fixe, keyé par le mot de passe. Le middleware recalcule ce jeton
// et le compare en temps constant. Compatible Edge (middleware) et Node (route)
// car on n'utilise que la Web Crypto API (globalThis.crypto.subtle).
// ---------------------------------------------------------------------------

export const AUTH_COOKIE = "cresus_auth";
const MESSAGE = "cresus-auth-v1";

export function authPassword(): string {
  return process.env.APP_PASSWORD || "";
}

/** true si la protection est active (mot de passe configuré). */
export function authEnabled(): boolean {
  return authPassword().length > 0;
}

/** IP de confiance (env ALLOWED_IPS, séparées par des virgules). */
export function allowedIps(): string[] {
  return (process.env.ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extrait l'IP client (Vercel : req.ip prioritaire, sinon x-forwarded-for). */
export function clientIp(directIp: string | undefined, xForwardedFor: string | null): string {
  if (directIp) return directIp;
  const xff = xForwardedFor || "";
  return xff.split(",")[0].trim();
}

/** true si l'IP est dans la liste de confiance (match exact ou préfixe "1.2.3."). */
export function isAllowedIp(ip: string): boolean {
  if (!ip) return false;
  return allowedIps().some((entry) => entry === ip || (entry.endsWith(".") && ip.startsWith(entry)));
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Jeton déterministe pour un mot de passe donné (HMAC-SHA256). */
async function tokenFor(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(MESSAGE));
  return b64url(sig);
}

/** Comparaison en temps constant de deux chaînes de même longueur. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Jeton attendu dans le cookie pour le mot de passe configuré. */
export async function makeToken(): Promise<string> {
  return tokenFor(authPassword());
}

/** Vérifie le cookie contre le mot de passe configuré. */
export async function verifyToken(token: string | undefined | null): Promise<boolean> {
  if (!token || !authEnabled()) return false;
  return safeEqual(token, await makeToken());
}

/** Vérifie un mot de passe saisi (temps constant, longueur non fuitée). */
export async function passwordMatches(input: string): Promise<boolean> {
  const pw = authPassword();
  if (!pw) return false;
  return safeEqual(await tokenFor(input), await tokenFor(pw));
}
