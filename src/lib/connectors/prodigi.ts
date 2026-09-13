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

export const prodigiConnector: Connector = {
  id: "prodigi",
  label: "Prodigi",
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (PRODIGI_API_KEY)" };
    }
    const key = process.env.PRODIGI_API_KEY!;
    const from = new Date(range.from).getTime();
    const to = new Date(range.to).getTime();
    const TOP = 100;
    const BATCHES = 8; // 8 lots de 100 = 800 commandes récentes couvertes

    // Un lot Prodigi, avec timeout individuel pour ne jamais bloquer.
    const fetchBatch = async (skip: number): Promise<ProdigiOrder[]> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`${BASE}/orders?top=${TOP}&skip=${skip}`, {
          headers: { "X-API-Key": key },
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { orders: ProdigiOrder[] };
        return data.orders ?? [];
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      // Commandes triées de la plus récente à la plus ancienne : on récupère les
      // BATCHES premiers lots EN PARALLÈLE (au lieu d'une boucle en série qui
      // dépassait le délai), puis on filtre par date.
      const skips = Array.from({ length: BATCHES }, (_, i) => i * TOP);
      const batches = await Promise.all(skips.map(fetchBatch));
      const entries: LedgerEntry[] = [];
      for (const batch of batches) {
        for (const o of batch) {
          const ts = new Date(o.created).getTime();
          if (isNaN(ts) || ts < from || ts >= to) continue;
          const charge = o.charges?.[0]?.totalCost;
          const cost = charge ? Number(charge.amount) : 0;
          if (cost > 0) {
            entries.push({
              id: `prodigi:order:${o.id}:cogs`,
              source: "prodigi",
              kind: "cogs",
              occurredAt: new Date(ts).toISOString(),
              amount: -cost,
              currency: charge!.currency || "GBP",
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
