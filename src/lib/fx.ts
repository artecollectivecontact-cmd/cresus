import type { Currency } from "./types";
import { BASE_CURRENCY } from "./config";

// ---------------------------------------------------------------------------
// Conversion de devises vers la devise de reporting (EUR).
//
// Deux modes :
//  - getConverter()      : un taux unique (le plus récent) — pour les affichages
//    d'appoint (ex. équivalent USD global).
//  - getDailyConverter() : un taux PAR JOUR, pour convertir chaque écriture au
//    taux réel de sa date (plus précis pour savoir ce qu'on a payé ce jour-là).
//
// Taux via l'API publique de la BCE (frankfurter.app, gratuite, sans clé) si
// FX_API=1, sinon taux de secours figés.
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

async function fetchJson(url: string, ms = 4000): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { next: { revalidate: 21600 }, signal: ctrl.signal }).finally(() =>
      clearTimeout(timer)
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchEcbRates(): Promise<Record<string, number> | null> {
  // frankfurter renvoie des taux base=EUR : 1 EUR = rates[XXX]. On veut l'inverse.
  const data = (await fetchJson("https://api.frankfurter.app/latest?from=EUR")) as
    | { rates?: Record<string, number> }
    | null;
  if (!data?.rates) return null;
  const toEur: Record<string, number> = { EUR: 1 };
  for (const [ccy, perEur] of Object.entries(data.rates)) {
    if (perEur > 0) toEur[ccy] = 1 / perEur;
  }
  return toEur;
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

// --- Taux par jour -----------------------------------------------------------

export interface DailyFxConverter {
  base: Currency;
  /** Taux du jour `day` (YYYY-MM-DD) : montant_base = amount * rateOn(from, day). */
  rateOn: (from: Currency, day: string) => number;
  convertOn: (amount: number, from: Currency, day: string) => number;
}

// Cache de la série temporelle (par plage demandée).
let seriesCache: { at: number; key: string; rates: Record<string, Record<string, number>> } | null = null;

async function fetchSeries(fromDay: string, toDay: string): Promise<Record<string, Record<string, number>>> {
  // base EUR : 1 EUR = rates[date][XXX]. Week-ends/fériés absents (on retombe
  // sur le dernier jour coté).
  const data = (await fetchJson(`https://api.frankfurter.app/${fromDay}..${toDay}?from=EUR`, 6000)) as
    | { rates?: Record<string, Record<string, number>> }
    | null;
  return data?.rates ?? {};
}

export async function getDailyConverter(fromDay: string, toDay: string): Promise<DailyFxConverter> {
  const base = BASE_CURRENCY;
  let series: Record<string, Record<string, number>> = {};
  if (process.env.FX_API === "1") {
    const key = `${fromDay}..${toDay}`;
    if (seriesCache && seriesCache.key === key && Date.now() - seriesCache.at < TTL_MS) {
      series = seriesCache.rates;
    } else {
      series = await fetchSeries(fromDay, toDay);
      seriesCache = { at: Date.now(), key, rates: series };
    }
  }
  const days = Object.keys(series).sort();

  // 1 unité de `from` -> combien d'EUR, au jour `day` (ou dernier jour coté avant).
  const perEurOn = (from: Currency, day: string): number | null => {
    const direct = series[day]?.[from];
    if (direct && direct > 0) return direct;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i] <= day) {
        const v = series[days[i]][from];
        if (v && v > 0) return v;
      }
    }
    for (const d of days) {
      const v = series[d][from];
      if (v && v > 0) return v;
    }
    return null;
  };

  const rateOn = (from: Currency, day: string): number => {
    if (from === base) return 1;
    const perEur = perEurOn(from, day); // 1 EUR = perEur FROM
    const fromEur = perEur ? 1 / perEur : FALLBACK_TO_EUR[from] ?? 1; // 1 FROM = X EUR
    if (base === "EUR") return fromEur;
    const basePerEur = perEurOn(base, day);
    const baseEur = basePerEur ? 1 / basePerEur : FALLBACK_TO_EUR[base] ?? 1;
    return fromEur / baseEur;
  };

  return {
    base,
    rateOn,
    convertOn: (amount, from, day) => amount * rateOn(from, day),
  };
}
