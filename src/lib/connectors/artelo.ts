import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Artelo — fournisseur POD (impression) => coût de prod + expédition.
// Doc : https://www.artelo.io/artelo-api (token généré depuis Integrations).
//
// ⚠️ La doc Artelo est inaccessible depuis l'environnement de build (bloquée par
// la politique réseau). Cette implémentation suit le pattern POD standard
// (Bearer token, liste d'orders paginée, coût par commande) avec un mapping de
// champs DÉFENSIF. Deux choses à confirmer avec la vraie doc/clé :
//   1) ARTELO_BASE (URL de base de l'API) et le path exact des commandes ;
//   2) les noms de champs du coût de prod, de l'expédition, de la devise et de
//      la référence marchand (voir COST_KEYS / SHIP_KEYS ci-dessous).
// Le reste de l'app est déjà prêt à consommer ces écritures normalisées.
// ---------------------------------------------------------------------------

const ENV = ["ARTELO_API_KEY"];
// Base et endpoint confirmés par la doc Artelo. Auth : Authorization: Bearer.
const BASE = process.env.ARTELO_BASE || "https://www.artelo.com/api/open";

type Json = Record<string, unknown>;

const DATE_KEYS = ["created_at", "createdAt", "created", "date", "placed_at"];
const COST_KEYS = ["production_cost", "product_cost", "items_cost", "cost", "total_cost", "subtotal"];
const SHIP_KEYS = ["shipping_cost", "shipping", "shipping_price", "delivery_cost"];
const REF_KEYS = ["merchant_reference", "external_id", "order_reference", "reference", "shop_order_id"];
const CCY_KEYS = ["currency", "currency_code"];

function num(o: Json, keys: string[]): number {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
    if (v && typeof v === "object") {
      const inner = (v as Json).amount ?? (v as Json).value;
      if (typeof inner === "number") return inner;
      if (typeof inner === "string" && !isNaN(Number(inner))) return Number(inner);
    }
  }
  return 0;
}
function str(o: Json, keys: string[]): string | undefined {
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
      // Un seul appel à /orders/get (rate limit 50/10s, pagination non encore
      // spécifiée). Parsing défensif : la liste peut être un tableau nu ou sous
      // orders/data/results, et les noms de champs coût/date sont tolérants.
      const res = await fetch(`${BASE}/orders/get`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Artelo HTTP ${res.status}`);
      const data = (await res.json()) as Json | Json[];
      const list: Json[] = Array.isArray(data)
        ? data
        : ((data.orders as Json[]) || (data.data as Json[]) || (data.results as Json[]) || []);

      const entries: LedgerEntry[] = [];
      for (const o of list) {
        const dateStr = str(o, DATE_KEYS);
        if (!dateStr) continue;
        const ts = new Date(dateStr.replace(" ", "T")).getTime();
        if (isNaN(ts) || ts < fromMs || ts >= toMs) continue;
        const iso = new Date(ts).toISOString();
        const currency = str(o, CCY_KEYS) || "EUR";
        const ref = str(o, REF_KEYS);
        const cost = num(o, COST_KEYS);
        const ship = num(o, SHIP_KEYS);
        if (cost > 0) {
          entries.push({
            id: `artelo:order:${str(o, ["id"]) || iso}:cogs`,
            source: "artelo",
            kind: "cogs",
            occurredAt: iso,
            amount: -cost,
            currency,
            label: `Prod. Artelo${ref ? ` (${ref})` : ""}`,
            ref,
          });
        }
        if (ship > 0) {
          entries.push({
            id: `artelo:order:${str(o, ["id"]) || iso}:ship`,
            source: "artelo",
            kind: "fulfillment",
            occurredAt: iso,
            amount: -ship,
            currency,
            label: `Expédition Artelo${ref ? ` (${ref})` : ""}`,
            ref,
          });
        }
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
