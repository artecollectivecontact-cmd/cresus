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
  charges?: { totalCost?: { amount: string; currency: string } }[];
}

// Somme de toutes les charges Prodigi (Item + Shipping + éventuels crédits).
// `amount` : positif = débit (coût), négatif = crédit (remboursement).
// NB : `charges` reste vide tant que Prodigi n'a pas facturé la commande, donc
// une commande toute récente peut renvoyer un coût de 0 (normal).
function sumCharges(o: ProdigiOrder): { cost: number; currency: string } {
  let cost = 0;
  let currency = "GBP";
  for (const c of o.charges ?? []) {
    const amt = c.totalCost?.amount;
    if (amt != null && !isNaN(Number(amt))) cost += Number(amt);
    if (c.totalCost?.currency) currency = c.totalCost.currency;
  }
  return { cost, currency };
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

    // Un lot filtré par date (createdFrom/createdTo), avec timeout individuel.
    const fetchBatch = async (skip: number): Promise<ProdigiOrder[]> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      try {
        const params = new URLSearchParams({
          top: String(TOP),
          skip: String(skip),
          createdFrom: range.from,
          createdTo: range.to,
        });
        const res = await fetch(`${BASE}/orders?${params.toString()}`, {
          headers: { "X-API-Key": key },
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { orders?: ProdigiOrder[] };
        return data.orders ?? [];
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      // Filtrage par date côté serveur + lots EN PARALLÈLE (au lieu d'une boucle
      // en série qui dépassait le délai sur 30 jours de commandes).
      const skips = Array.from({ length: BATCHES }, (_, i) => i * TOP);
      const batches = await Promise.all(skips.map(fetchBatch));
      const entries: LedgerEntry[] = [];
      for (const batch of batches) {
        for (const o of batch) {
          const ts = new Date(o.created).getTime();
          const { cost, currency } = sumCharges(o);
          if (cost > 0) {
            entries.push({
              id: `prodigi:order:${o.id}:cogs`,
              source: "prodigi",
              kind: "cogs",
              occurredAt: isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString(),
              amount: -cost,
              currency,
              label: `Prod. Prodigi${o.merchantReference ? ` (${o.merchantReference})` : ""}`,
              ref: o.merchantReference,
            });
          }
        }
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
