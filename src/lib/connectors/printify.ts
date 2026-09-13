import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Printify — coût de production POD + frais d'expédition fournisseur.
// API REST officielle : https://developers.printify.com  (Bearer token).
//
// Les montants Printify sont en centimes. On rattache chaque coût au n° de
// commande Shopify via order.metadata.shop_order_label (à vérifier selon ton
// intégration) pour matcher revenus et coûts sur la même commande.
// ---------------------------------------------------------------------------

const ENV = ["PRINTIFY_API_TOKEN"];
const BASE = "https://api.printify.com/v1";

interface PrintifyOrder {
  id: string;
  created_at: string; // "2026-09-13 16:01:43+00:00"
  metadata?: { shop_order_label?: string; order_type?: string };
  total_price?: number; // centimes, prix produit
  total_shipping?: number; // centimes
  line_items?: { metadata?: { price?: number } }[];
}

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Printify HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const printifyConnector: Connector = {
  id: "printify",
  label: "Printify",
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (PRINTIFY_API_TOKEN)" };
    }
    const token = process.env.PRINTIFY_API_TOKEN!;
    const shopId = process.env.PRINTIFY_SHOP_ID;
    try {
      const shops = shopId
        ? [{ id: shopId }]
        : await api<{ id: string }[]>(token, "/shops.json");
      const from = new Date(range.from).getTime();
      const to = new Date(range.to).getTime();
      const entries: LedgerEntry[] = [];

      for (const shop of shops) {
        let page = 1;
        // Les commandes sont renvoyées de la plus récente à la plus ancienne :
        // dès qu'une page ne contient que des commandes plus vieilles que la
        // période, on s'arrête (évite de scanner tout l'historique).
        // Limite Printify pour les orders : 10 par page (au-delà => HTTP 400).
        let reachedOlder = false;
        // eslint-disable-next-line no-constant-condition
        while (!reachedOlder) {
          const res = await api<{ data: PrintifyOrder[]; last_page: number }>(
            token,
            `/shops/${shop.id}/orders.json?page=${page}&limit=10`
          );
          let anyInRangeOrNewer = false;
          for (const o of res.data) {
            const ts = new Date(o.created_at.replace(" ", "T")).getTime();
            if (!isNaN(ts) && ts >= from) anyInRangeOrNewer = true;
            if (isNaN(ts) || ts < from || ts >= to) continue;
            const ref = o.metadata?.shop_order_label;
            const iso = new Date(ts).toISOString();
            const cogs = (o.total_price ?? 0) / 100;
            const ship = (o.total_shipping ?? 0) / 100;
            if (cogs > 0) {
              entries.push({
                id: `printify:order:${o.id}:cogs`,
                source: "printify",
                kind: "cogs",
                occurredAt: iso,
                amount: -cogs,
                currency: "USD",
                label: `Prod. Printify${ref ? ` (${ref})` : ""}`,
                ref,
              });
            }
            if (ship > 0) {
              entries.push({
                id: `printify:order:${o.id}:ship`,
                source: "printify",
                kind: "fulfillment",
                occurredAt: iso,
                amount: -ship,
                currency: "USD",
                label: `Expédition Printify${ref ? ` (${ref})` : ""}`,
                ref,
              });
            }
          }
          // Fin si dernière page, page vide, ou plus aucune commande récente.
          if (page >= res.last_page || res.data.length === 0) break;
          if (!anyInRangeOrNewer) reachedOlder = true;
          page++;
        }
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
