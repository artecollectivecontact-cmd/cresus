import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Prodigi — coût de production POD + expédition.
// API REST : https://www.prodigi.com/print-api/docs/reference/  (header X-API-Key).
// Montants Prodigi exprimés en unités monétaires (pas en centimes) + devise.
// ---------------------------------------------------------------------------

const ENV = ["PRODIGI_API_KEY"];
const BASE = process.env.PRODIGI_BASE || "https://api.prodigi.com/v4.0";

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
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (PRODIGI_API_KEY)" };
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
      // Diagnostic : distingue "0 commande renvoyée" de "commandes non facturées"
      // (charges vides = facturation mensuelle Prodigi en attente).
      const detail =
        entries.length > 0
          ? `${entries.length} écritures (${billedCount}/${orderCount} commandes facturées)`
          : orderCount > 0
          ? `0 écriture — ${orderCount} commandes mais charges vides (facturation Prodigi en attente)`
          : "0 écriture — aucune commande renvoyée sur la fenêtre (filtre date/endpoint ?)";
      return { entries, state: "live", detail };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
