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
    try {
      const from = new Date(range.from).getTime();
      const to = new Date(range.to).getTime();
      const entries: LedgerEntry[] = [];
      let skip = 0;
      // Commandes renvoyées de la plus récente à la plus ancienne : on s'arrête
      // dès qu'un lot ne contient plus rien dans la période (évite de scanner
      // tout l'historique et de dépasser le délai).
      let reachedOlder = false;
      while (!reachedOlder) {
        const res = await fetch(`${BASE}/orders?top=50&skip=${skip}`, {
          headers: { "X-API-Key": key },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Prodigi HTTP ${res.status}`);
        const data = (await res.json()) as { orders: ProdigiOrder[] };
        const batch = data.orders ?? [];
        let anyInRangeOrNewer = false;
        for (const o of batch) {
          const ts = new Date(o.created).getTime();
          if (!isNaN(ts) && ts >= from) anyInRangeOrNewer = true;
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
        if (batch.length < 50) break;
        if (!anyInRangeOrNewer) reachedOlder = true;
        skip += 50;
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
