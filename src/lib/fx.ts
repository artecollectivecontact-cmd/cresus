import type { Currency } from "./types";
import { BASE_CURRENCY } from "./config";

// ---------------------------------------------------------------------------
// Conversion de devises vers la devise de reporting.
//
// Par défaut on utilise des taux figés (fallback hors-ligne, suffisant pour un
// tableau de bord). Si FX_API=1, on interroge l'API publique de la BCE via
// frankfurter.app (gratuite, sans clé) et on met en cache le résultat.
// ---------------------------------------------------------------------------

/** Taux de secours : 1 unité de la devise -> X unités de BASE_CURRENCY (EUR). */
const FALLBACK_TO_EUR: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.04,
};

let cache: { at: number; rates: Record<string, number> } | null = null;
const TTL_MS = 1000 * 60 * 60 * 6; // 6 h

async function fetchEcbRates(): Promise<Record<string, number> | null> {
  try {
    // frankfurter renvoie des taux base=EUR : 1 EUR = rates[XXX].
    const res = await fetch("https://api.frankfurter.app/latest?from=EUR", {
      next: { revalidate: 21600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates: Record<string, number> };
    // On veut l'inverse : 1 XXX = (1 / rates[XXX]) EUR.
    const toEur: Record<string, number> = { EUR: 1 };
    for (const [ccy, perEur] of Object.entries(data.rates)) {
      if (perEur > 0) toEur[ccy] = 1 / perEur;
    }
    return toEur;
  } catch {
    return null;
  }
}

async function ratesToEur(): Promise<Record<string, number>> {
  if (process.env.FX_API !== "1") return FALLBACK_TO_EUR;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rates;
  const live = await fetchEcbRates();
  const rates = live ? { ...FALLBACK_TO_EUR, ...live } : FALLBACK_TO_EUR;
  cache = { at: Date.now(), rates };
  return rates;
}

export interface FxConverter {
  base: Currency;
  /** Taux appliqué : montant_base = amount * rate(from). */
  rate: (from: Currency) => number;
  convert: (amount: number, from: Currency) => number;
}

export async function getConverter(): Promise<FxConverter> {
  const toEur = await ratesToEur();
  const base = BASE_CURRENCY;

  const rate = (from: Currency): number => {
    if (from === base) return 1;
    const fromEur = toEur[from] ?? FALLBACK_TO_EUR[from] ?? 1; // 1 from = X EUR
    if (base === "EUR") return fromEur;
    const baseEur = toEur[base] ?? FALLBACK_TO_EUR[base] ?? 1; // 1 base = Y EUR
    return fromEur / baseEur;
  };

  return {
    base,
    rate,
    convert: (amount, from) => amount * rate(from),
  };
}
