import type { Currency } from "./types";

export function money(n: number, currency: Currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: n >= 1000 || n <= -1000 ? 0 : 2,
  }).format(n);
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)} %`;
}

/** Équivalent USD d'un montant EUR (affichage secondaire, sans décimales). */
export function usd(eur: number, usdPerEur: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(eur * usdPerEur);
}

export function dayLabel(key: string): string {
  // key = "YYYY-MM-DD"
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

export function signedClass(n: number): string {
  if (n > 0) return "text-pos";
  if (n < 0) return "text-neg";
  return "text-muted";
}
