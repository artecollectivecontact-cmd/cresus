import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Artelo — fournisseur POD (impression) => coût de prod + expédition.
// Doc : https://www.artelo.com/api/open  (Authorization: Bearer).
// Endpoint : GET /orders/get — paramètres : limit (requis), offset, minDate,
// maxDate, sortDirection (defaut desc), allOrders. Rate limit : 50 req / 10s.
//
// Les coûts sont imbriqués dans `details` :
//   productionCost, branding, gst, hst, pst, usSalesTax, arteloShipping,
//   amountRefunded, wholesaleDiscount.
// COGS = productionCost + branding + taxes − remboursements − remises.
// Expédition = arteloShipping. Devise absente de la réponse => USD par défaut.
// ---------------------------------------------------------------------------

const ENV = ["ARTELO_API_KEY"];
const BASE = process.env.ARTELO_BASE || "https://www.artelo.com/api/open";
const CURRENCY = process.env.ARTELO_CURRENCY || "USD";
const PAGE = 100;

type Json = Record<string, unknown>;

function n(o: Json | undefined, key: string): number {
  if (!o) return 0;
  const v = o[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return 0;
}
function s(o: Json, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}

export const arteloConnector: Connector = {
  id: "artelo",
  label: "Artelo",
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (ARTELO_API_KEY)" };
    }
    const key = process.env.ARTELO_API_KEY!;
    const fromMs = new Date(range.from).getTime();
    const toMs = new Date(range.to).getTime();
    try {
      const entries: LedgerEntry[] = [];
      let offset = 0;
      let guard = 0;
      // Filtrage par date côté serveur (minDate/maxDate) => peu de pages.
      while (guard++ < 20) {
        const params = new URLSearchParams({
          limit: String(PAGE),
          offset: String(offset),
          minDate: range.from,
          maxDate: range.to,
          sortDirection: "desc",
          allOrders: "true",
        });
        const res = await fetch(`${BASE}/orders/get?${params.toString()}`, {
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Artelo HTTP ${res.status}`);
        const data = (await res.json()) as Json | Json[];
        const list: Json[] = Array.isArray(data)
          ? (data as Json[])
          : ((data.orders as Json[]) || (data.data as Json[]) || (data.results as Json[]) || []);

        for (const o of list) {
          const dateStr = s(o, ["createdAt", "created_at", "created", "date"]);
          if (!dateStr) continue;
          const ts = new Date(dateStr).getTime();
          if (isNaN(ts) || ts < fromMs || ts >= toMs) continue;
          const iso = new Date(ts).toISOString();
          const d = (o.details as Json) || undefined;
          const cogs =
            n(d, "productionCost") +
            n(d, "branding") +
            n(d, "gst") +
            n(d, "hst") +
            n(d, "pst") +
            n(d, "usSalesTax") -
            n(d, "amountRefunded") -
            n(d, "wholesaleDiscount");
          const ship = n(d, "arteloShipping");
          const ref = s(o, ["orderId", "name"]) || s(o, ["id"]);
          const oid = s(o, ["id"]) || iso;
          const addr = (o.customerAddress as Json) || undefined;
          const country = addr ? s(addr, ["countryCode", "country"]) : undefined;
          if (cogs > 0) {
            entries.push({
              id: `artelo:order:${oid}:cogs`,
              source: "artelo",
              kind: "cogs",
              occurredAt: iso,
              amount: -cogs,
              currency: CURRENCY,
              label: `Prod. Artelo${ref ? ` (${ref})` : ""}`,
              country,
              ref,
            });
          }
          if (ship > 0) {
            entries.push({
              id: `artelo:order:${oid}:ship`,
              source: "artelo",
              kind: "fulfillment",
              occurredAt: iso,
              amount: -ship,
              currency: CURRENCY,
              label: `Expédition Artelo${ref ? ` (${ref})` : ""}`,
              country,
              ref,
            });
          }
        }
        if (list.length < PAGE) break;
        offset += PAGE;
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
