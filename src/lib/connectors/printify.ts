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
  address_to?: { country?: string }; // pays de destination (ISO)
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
      // Limite Printify pour les orders : 10 par page (au-delà => HTTP 400).
      // Commandes triées de la plus récente à la plus ancienne. Pour éviter les
      // dizaines de pages en série (=> timeout), on récupère la page 1 puis
      // TOUTES les autres pages EN PARALLÈLE, plafonnées à MAX_PAGES récentes.
      const MAX_PAGES = 40;

      const pushOrder = (o: PrintifyOrder) => {
        const ts = new Date(o.created_at.replace(" ", "T")).getTime();
        if (isNaN(ts) || ts < from || ts >= to) return;
        const ref = o.metadata?.shop_order_label;
        const country = o.address_to?.country; // pays de destination (ISO)
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
            country,
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
            country,
            ref,
          });
        }
      };

      for (const shop of shops) {
        const first = await api<{ data: PrintifyOrder[]; last_page: number }>(
          token,
          `/shops/${shop.id}/orders.json?page=1&limit=10`
        );
        first.data.forEach(pushOrder);
        const lastPage = Math.min(first.last_page || 1, MAX_PAGES);
        if (lastPage > 1) {
          const pages = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
          const results = await Promise.all(
            pages.map((p) =>
              api<{ data: PrintifyOrder[] }>(token, `/shops/${shop.id}/orders.json?page=${p}&limit=10`).catch(
                () => ({ data: [] as PrintifyOrder[] })
              )
            )
          );
          for (const r of results) r.data.forEach(pushOrder);
        }
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
