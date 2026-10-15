import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";
import prodigiCsv from "../data/prodigi-orders.json";

// ---------------------------------------------------------------------------
// Connecteur Prodigi — coût de production POD + expédition.
// API REST : https://www.prodigi.com/print-api/docs/reference/  (header X-API-Key).
// Montants Prodigi exprimés en unités monétaires (pas en centimes) + devise.
//
// L'API /orders de ce compte ne liste rien (orders vides), donc on se replie
// sur un export CSV Prodigi importé (src/lib/data/prodigi-orders.json) :
// coûts RÉELS par commande (Order Reference = ID Shopify), en EUR. À rafraîchir
// en réexportant depuis Prodigi.
// ---------------------------------------------------------------------------

const ENV = ["PRODIGI_API_KEY"];
const BASE = process.env.PRODIGI_BASE || "https://api.prodigi.com/v4.0";

interface ProdigiCsvRow {
  ref: string;
  date: string;
  cogs: number;
  shipping: number;
  currency: string;
  country: string;
}

/** Écritures issues de l'export CSV, filtrées sur la fenêtre. */
function fromCsv(range: DateRange): LedgerEntry[] {
  const fromMs = new Date(range.from).getTime();
  const toMs = new Date(range.to).getTime();
  const entries: LedgerEntry[] = [];
  for (const o of prodigiCsv as ProdigiCsvRow[]) {
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(o.date) ? o.date : `${o.date}Z`;
    const t = new Date(iso).getTime();
    if (isNaN(t) || t < fromMs || t >= toMs) continue;
    const ccy = o.currency || "EUR";
    if (o.cogs > 0) {
      entries.push({
        id: `prodigi:csv:${o.ref}:cogs`,
        source: "prodigi",
        kind: "cogs",
        occurredAt: iso,
        amount: -o.cogs,
        currency: ccy,
        label: `Prod. Prodigi (${o.ref})`,
        country: o.country,
        ref: o.ref,
      });
    }
    if (o.shipping > 0) {
      entries.push({
        id: `prodigi:csv:${o.ref}:ship`,
        source: "prodigi",
        kind: "fulfillment",
        occurredAt: iso,
        amount: -o.shipping,
        currency: ccy,
        label: `Livraison Prodigi (${o.ref})`,
        country: o.country,
        ref: o.ref,
      });
    }
  }
  return entries;
}

interface ProdigiOrder {
  id: string;
  created: string;
  merchantReference?: string;
  recipient?: { address?: { countryCode?: string } };
  charges?: { chargeType?: string; totalCost?: { amount: string; currency: string } }[];
}

// Sépare Impression (Item/Other) et Livraison (Shipping) depuis les charges.
// `amount` : positif = débit (coût), négatif = crédit (remboursement).
// NB : `charges` reste vide tant que Prodigi n'a pas facturé la commande, donc
// une commande toute récente peut renvoyer un coût de 0 (normal).
function splitCharges(o: ProdigiOrder): { print: number; ship: number; currency: string } {
  let print = 0;
  let ship = 0;
  let currency = "GBP";
  for (const c of o.charges ?? []) {
    const amt = c.totalCost?.amount;
    if (amt == null || isNaN(Number(amt))) continue;
    const val = Number(amt);
    if (c.totalCost?.currency) currency = c.totalCost.currency;
    if (c.chargeType === "Shipping") ship += val;
    else print += val; // Item, Other, Refund...
  }
  return { print, ship, currency };
}

export const prodigiConnector: Connector = {
  id: "prodigi",
  label: "Prodigi",
  // Configuré si clé API OU données CSV disponibles.
  isConfigured: () => hasEnv(ENV) || (prodigiCsv as unknown[]).length > 0,

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      // Pas de clé API : on sert directement les coûts réels du CSV.
      const csv = fromCsv(range);
      return csv.length > 0
        ? { entries: csv, state: "live", detail: `${csv.length} écritures (import CSV — pas de clé API)` }
        : { entries: [], state: "stub", detail: "clé absente et aucune donnée CSV" };
    }
    const key = process.env.PRODIGI_API_KEY!;
    const TOP = 100;
    const BATCHES = 12; // 12 x 100 = 1200 commandes de la fenêtre couvertes

    let anyOk = false; // au moins un appel a répondu (sinon => erreur, pas "0")

    // Prodigi attend un ISO 8601 sans millisecondes (ex: 2026-09-16T00:00:00Z).
    const isoNoMs = (s: string) => s.replace(/\.\d{3}(Z|[+-]\d{2}:?\d{2})$/, "$1");
    const fromIso = isoNoMs(range.from);
    const toIso = isoNoMs(range.to);

    const fetchBatch = async (skip: number): Promise<ProdigiOrder[]> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      try {
        const p = new URLSearchParams({
          top: String(TOP),
          skip: String(skip),
          createdFrom: fromIso,
          createdTo: toIso,
        });
        const res = await fetch(`${BASE}/orders?${p.toString()}`, {
          headers: { "X-API-Key": key },
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) return [];
        anyOk = true;
        const data = (await res.json()) as { orders?: ProdigiOrder[] };
        return data.orders ?? [];
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      // Lots EN PARALLÈLE (au lieu d'une boucle en série qui dépassait le délai).
      const skips = Array.from({ length: BATCHES }, (_, i) => i * TOP);
      const batches = await Promise.all(skips.map(fetchBatch));
      if (!anyOk) return { entries: [], state: "error", detail: "Prodigi injoignable (tous les appels ont échoué)" };
      const entries: LedgerEntry[] = [];
      let orderCount = 0; // commandes renvoyées par l'API
      let billedCount = 0; // commandes avec au moins une charge (donc facturées)
      for (const batch of batches) {
        for (const o of batch) {
          orderCount++;
          const ts = new Date(o.created).getTime();
          const iso = isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
          const { print, ship, currency } = splitCharges(o);
          if (print !== 0 || ship !== 0) billedCount++;
          const country = o.recipient?.address?.countryCode; // pays de destination (UK/EU/…)
          const ref = o.merchantReference;
          const label = `Prodigi${ref ? ` (${ref})` : ""}`;
          if (print !== 0) {
            entries.push({
              id: `prodigi:order:${o.id}:cogs`,
              source: "prodigi",
              kind: "cogs",
              occurredAt: iso,
              amount: -print,
              currency,
              label: `Prod. ${label}`,
              country,
              ref,
            });
          }
          if (ship !== 0) {
            entries.push({
              id: `prodigi:order:${o.id}:ship`,
              source: "prodigi",
              kind: "fulfillment",
              occurredAt: iso,
              amount: -ship,
              currency,
              label: `Livraison ${label}`,
              country,
              ref,
            });
          }
        }
      }
      // L'API ne liste rien pour ce compte -> on se replie sur l'export CSV
      // (coûts réels par commande). On ne mélange pas : API si elle renvoie des
      // écritures, sinon CSV.
      if (entries.length > 0) {
        return {
          entries,
          state: "live",
          detail: `${entries.length} écritures API (${billedCount}/${orderCount} facturées)`,
        };
      }
      const csv = fromCsv(range);
      if (csv.length > 0) {
        return { entries: csv, state: "live", detail: `${csv.length} écritures (import CSV — API vide)` };
      }
      return {
        entries: [],
        state: "live",
        detail:
          orderCount > 0
            ? `0 écriture — ${orderCount} commandes mais charges vides`
            : "0 écriture — API vide et aucune donnée CSV sur la fenêtre",
      };
    } catch {
      // En cas d'échec API, on sert quand même les coûts réels du CSV.
      const csv = fromCsv(range);
      if (csv.length > 0) return { entries: csv, state: "live", detail: `${csv.length} écritures (import CSV)` };
      return { entries: [], state: "error", detail: "Prodigi API injoignable et CSV vide sur la fenêtre" };
    }
  },
};
