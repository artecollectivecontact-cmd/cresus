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
    try {
      // Filtrage par date CÔTÉ SERVEUR (createdFrom/createdTo) : l'ordre de tri
      // n'a plus d'importance et le jeu est petit. On pagine avec top/skip.
      const entries: LedgerEntry[] = [];
      let skip = 0;
      let guard = 0;
      // eslint-disable-next-line no-constant-condition
      while (guard++ < 15) {
        const params = new URLSearchParams({
          top: String(TOP),
          skip: String(skip),
          createdFrom: range.from,
          createdTo: range.to,
        });
        const res = await fetch(`${BASE}/orders?${params.toString()}`, {
          headers: { "X-API-Key": key },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Prodigi HTTP ${res.status}`);
        const data = (await res.json()) as { orders?: ProdigiOrder[] };
        const batch = data.orders ?? [];
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
        if (batch.length < TOP) break;
        skip += TOP;
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
