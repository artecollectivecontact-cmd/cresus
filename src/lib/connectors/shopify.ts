import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";

// ---------------------------------------------------------------------------
// Connecteur Shopify — source de CA (ventes) et de TVA collectée.
//
// Deux modes d'authentification à l'Admin API (Dev Dashboard 2026) :
//   1) SHOPIFY_ADMIN_TOKEN : un token Admin API fourni à la main (shpat_… ou
//      app automation token atkn_…). Utilisé tel quel.
//   2) SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET : l'app échange ces identifiants
//      contre un token via le "client credentials grant" et le renouvelle toute
//      seule (le token expire au bout de 24h). Marche car l'app et la boutique
//      sont dans la même organisation. C'est le mode recommandé.
//
// Sinon, le registre bascule sur les données de démonstration.
// ---------------------------------------------------------------------------

const API_VERSION = "2024-10";

function shop(): string {
  return process.env.SHOPIFY_SHOP || "";
}
function directToken(): string {
  return process.env.SHOPIFY_ADMIN_TOKEN || "";
}
function clientCreds(): { id: string; secret: string } | null {
  const id = process.env.SHOPIFY_CLIENT_ID || "";
  const secret = process.env.SHOPIFY_CLIENT_SECRET || "";
  return id && secret ? { id, secret } : null;
}
function isConfigured(): boolean {
  return !!shop() && (!!directToken() || !!clientCreds());
}

// Cache mémoire du token issu du client-credentials (par instance serverless).
let tokenCache: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (directToken()) return directToken();

  const creds = clientCreds();
  if (!creds) throw new Error("Shopify: ni token ni client_id/secret configurés");

  // Réutilise le token en cache tant qu'il reste >5 min de validité.
  if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60_000) {
    return tokenCache.token;
  }

  const res = await fetch(`https://${shop()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify token HTTP ${res.status}${body ? ` — ${body.slice(0, 120)}` : ""}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  if (!data.access_token) throw new Error("Shopify: réponse token sans access_token");
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 86399) * 1000,
  };
  return tokenCache.token;
}

interface GqlOrder {
  id: string;
  name: string;
  createdAt: string;
  currentSubtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  currentTotalTaxSet: { shopMoney: { amount: string; currencyCode: string } };
  totalShippingPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: { countryCodeV2: string | null } | null;
}

async function gql<T>(token: string, query: string, variables: object): Promise<T> {
  const res = await fetch(`https://${shop()}/admin/api/${API_VERSION}/graphql.json`, {
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
  isConfigured,

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!isConfigured()) {
      return { entries: [], state: "stub", detail: "clé absente (token ou client_id/secret)" };
    }
    try {
      const token = await accessToken();
      const entries: LedgerEntry[] = [];
      const search = `created_at:>=${range.from} created_at:<${range.to}`;
      let cursor: string | null = null;

      do {
        const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlOrder[] } } =
          await gql(token, ORDERS_QUERY, { query: search, cursor });
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
      const msg = (e as Error).message;
      // Accès refusé / non autorisé : le token en cache est peut-être périmé
      // (scope ajouté depuis). On le jette pour en redemander un frais.
      if (/ACCESS_DENIED|401|403/.test(msg)) tokenCache = null;
      return { entries: [], state: "error", detail: msg };
    }
  },
};
