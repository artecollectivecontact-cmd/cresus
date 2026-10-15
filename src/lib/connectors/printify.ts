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

// Rebate Printify Choice sur les Rolled Posters, actif depuis septembre 2026.
// Printify facture encore le prix courant puis crédite le rabais à part, donc
// l'API SUR-estime le coût. On déduit l'économie réelle par taille (prix
// courant - prix custom), appliquée par article depuis REBATE_START.
const REBATE_START = Date.parse("2026-09-01T00:00:00Z");
const POSTER_REBATE: { size: string; save: number }[] = [
  { size: "12x18", save: 5.74 - 3.48 }, // 2.26
  { size: "20x30", save: 5.26 - 4.35 }, // 0.91
  { size: "24x36", save: 7.07 - 3.83 }, // 3.24
];

// Normalise un libellé de variante pour détecter la taille : minuscule, retire
// pouces/guillemets/espaces, unifie le séparateur (× -> x).
// "Matte / 12″ x 18″ (Vertical)" -> "matte/12x18(vertical)".
function normSize(s: string): string {
  return s.toLowerCase().replace(/[″"”'′\s]/g, "").replace(/×/g, "x");
}

interface PrintifyLineItem {
  quantity?: number;
  metadata?: { title?: string; variant_label?: string; sku?: string; price?: number };
}

interface PrintifyOrder {
  id: string;
  created_at: string; // "2026-09-13 16:01:43+00:00"
  metadata?: { shop_order_label?: string; order_type?: string };
  total_price?: number; // centimes, prix produit
  total_shipping?: number; // centimes
  address_to?: { country?: string }; // pays de destination (ISO)
  line_items?: PrintifyLineItem[];
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
      let rebateOrders = 0; // nb de commandes où un rabais a été appliqué
      const labelSamples: string[] = []; // échantillon de libellés d'articles (debug)
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
        let cogs = (o.total_price ?? 0) / 100;
        const ship = (o.total_shipping ?? 0) / 100;

        // Rebate Printify Choice (Rolled Posters) : on déduit l'économie réelle
        // par article depuis septembre. L'API facture encore le prix courant.
        let rebateSaved = 0;
        if (ts >= REBATE_START && o.line_items?.length) {
          for (const li of o.line_items) {
            const qty = li.quantity ?? 1;
            const raw = `${li.metadata?.variant_label ?? ""} ${li.metadata?.title ?? ""}`.trim();
            if (labelSamples.length < 8 && raw) labelSamples.push(raw.slice(0, 50));
            const txt = normSize(`${raw} ${li.metadata?.sku ?? ""}`);
            const hit = POSTER_REBATE.find((r) => txt.includes(r.size));
            if (hit) rebateSaved += hit.save * qty;
          }
          if (rebateSaved > 0) {
            cogs = Math.max(0, cogs - rebateSaved);
            rebateOrders++;
          }
        }

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
            meta: rebateSaved > 0 ? { rebate: Math.round(rebateSaved * 100) / 100 } : undefined,
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
      const rebateNote = rebateOrders > 0 ? ` · rebate ${rebateOrders} cmd` : "";
      const sampleNote = labelSamples.length ? ` · ex: ${labelSamples.slice(0, 3).join(" | ")}` : "";
      return { entries, state: "live", detail: `${entries.length} écritures${rebateNote}${sampleNote}` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
