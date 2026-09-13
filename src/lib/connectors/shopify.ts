import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Shopify — source de CA (ventes) et de TVA collectée.
//
// Utilise l'Admin GraphQL API. Passe en "live" dès que SHOPIFY_SHOP et
// SHOPIFY_ADMIN_TOKEN sont définis. Sinon, le registre bascule sur les données
// de démonstration (src/lib/sample-data.ts) figées depuis la vraie boutique.
// ---------------------------------------------------------------------------

const ENV = ["SHOPIFY_SHOP", "SHOPIFY_ADMIN_TOKEN"];
const API_VERSION = "2024-10";

interface GqlOrder {
  id: string;
  name: string;
  createdAt: string;
  currentSubtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  currentTotalTaxSet: { shopMoney: { amount: string; currencyCode: string } };
  totalShippingPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: { countryCodeV2: string | null } | null;
}

async function gql<T>(shop: string, token: string, query: string, variables: object): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

const ORDERS_QUERY = `
  query Orders($query: String!, $cursor: String) {
    orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        currentTotalTaxSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { countryCodeV2 }
      }
    }
  }
`;

export const shopifyConnector: Connector = {
  id: "shopify",
  label: "Shopify",
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (SHOPIFY_ADMIN_TOKEN)" };
    }
    const shop = process.env.SHOPIFY_SHOP!;
    const token = process.env.SHOPIFY_ADMIN_TOKEN!;
    try {
      const entries: LedgerEntry[] = [];
      const search = `created_at:>=${range.from} created_at:<${range.to}`;
      let cursor: string | null = null;

      do {
        const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlOrder[] } } =
          await gql(shop, token, ORDERS_QUERY, { query: search, cursor });
        for (const o of data.orders.nodes) {
          const ccy = o.currentSubtotalPriceSet.shopMoney.currencyCode;
          const country = o.shippingAddress?.countryCodeV2 ?? undefined;
          const subtotal = Number(o.currentSubtotalPriceSet.shopMoney.amount);
          const tax = Number(o.currentTotalTaxSet.shopMoney.amount);
          const shipping = Number(o.totalShippingPriceSet.shopMoney.amount);

          entries.push({
            id: `shopify:order:${o.id}:revenue`,
            source: "shopify",
            kind: "revenue",
            occurredAt: o.createdAt,
            amount: subtotal,
            currency: ccy,
            label: `Commande ${o.name}`,
            country,
            ref: o.name,
          });
          if (tax > 0) {
            entries.push({
              id: `shopify:order:${o.id}:tax`,
              source: "shopify",
              kind: "tax_collected",
              occurredAt: o.createdAt,
              amount: tax,
              currency: ccy,
              label: `TVA collectée ${o.name}`,
              country,
              ref: o.name,
            });
          }
          if (shipping > 0) {
            entries.push({
              id: `shopify:order:${o.id}:shipping-in`,
              source: "shopify",
              kind: "revenue",
              occurredAt: o.createdAt,
              amount: shipping,
              currency: ccy,
              label: `Port facturé ${o.name}`,
              country,
              ref: o.name,
            });
          }
        }
        cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
      } while (cursor);

      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
