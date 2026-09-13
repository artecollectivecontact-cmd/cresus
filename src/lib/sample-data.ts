import type { LedgerEntry } from "./types";
import { VAT_RATES } from "./config";

// ---------------------------------------------------------------------------
// Données de DÉMONSTRATION.
//
// Utilisées uniquement quand Shopify n'est pas branché (pas de SHOPIFY_ADMIN_TOKEN),
// pour que le tableau de bord affiche des chiffres tout de suite. Elles sont
// amorcées avec de VRAIES commandes de la boutique Arte Collective (récupérées
// le 2026-09-13 via l'API Shopify), complétées par un historique synthétique
// pour remplir les graphes. Le rapport est alors marqué `demo: true`.
//
// Le pricing Shopify est TVA incluse : total_TTC = HT * (1 + tva_pays).
// On stocke le HT en `revenue` et la TVA en `tax_collected`, comme le fait le
// vrai connecteur.
// ---------------------------------------------------------------------------

interface RawOrder {
  name: string;
  createdAt: string; // ISO UTC
  total: number; // TTC en USD
  country: string; // ISO alpha-2
}

// Les 10 vraies commandes du 2026-09-13 (montants réels). Pays connu pour #4683
// (DE) ; les autres sont approximés sur des marchés EU typiques pour la démo.
const REAL_TODAY: RawOrder[] = [
  { name: "#4683", createdAt: "2026-09-13T16:01:43Z", total: 162.12, country: "DE" },
  { name: "#4682", createdAt: "2026-09-13T15:46:12Z", total: 75.1, country: "FR" },
  { name: "#4681", createdAt: "2026-09-13T15:35:12Z", total: 213.0, country: "DE" },
  { name: "#4680", createdAt: "2026-09-13T12:17:36Z", total: 223.58, country: "IT" },
  { name: "#4679", createdAt: "2026-09-13T11:50:52Z", total: 80.91, country: "FR" },
  { name: "#4678", createdAt: "2026-09-13T11:39:43Z", total: 149.52, country: "ES" },
  { name: "#4677", createdAt: "2026-09-13T11:06:55Z", total: 144.0, country: "DE" },
  { name: "#4676", createdAt: "2026-09-13T09:44:25Z", total: 61.02, country: "BE" },
  { name: "#4675", createdAt: "2026-09-13T09:35:46Z", total: 118.2, country: "FR" },
  { name: "#4674", createdAt: "2026-09-13T06:23:04Z", total: 78.0, country: "NL" },
];

const COUNTRIES = ["FR", "DE", "IT", "ES", "BE", "NL", "AT", "GB", "US"];

// Générateur pseudo-aléatoire déterministe (mulberry32) : même démo à chaque run.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Génère un historique synthétique de commandes sur `days` jours avant `today`. */
function buildHistory(today: Date, days: number): RawOrder[] {
  const rand = rng(20260913);
  const orders: RawOrder[] = [];
  let counter = 4673;
  for (let d = 1; d <= days; d++) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - d);
    // Volume journalier : 8 à 22 commandes, plus faible le week-end.
    const weekend = [0, 6].includes(day.getUTCDay());
    const count = Math.floor(8 + rand() * 14 * (weekend ? 0.6 : 1));
    for (let i = 0; i < count; i++) {
      // Heures concentrées 8h-22h.
      const hour = Math.floor(8 + rand() * 14);
      const minute = Math.floor(rand() * 60);
      const ts = new Date(day);
      ts.setUTCHours(hour, minute, Math.floor(rand() * 60), 0);
      const total = Math.round((45 + rand() * 190) * 100) / 100;
      const country = COUNTRIES[Math.floor(rand() * COUNTRIES.length)];
      orders.push({
        name: `#${counter--}`,
        createdAt: ts.toISOString(),
        total,
        country,
      });
    }
  }
  return orders;
}

function orderToEntries(o: RawOrder): LedgerEntry[] {
  const vatRate = VAT_RATES[o.country] ?? 0.2;
  const net = Math.round((o.total / (1 + vatRate)) * 100) / 100;
  const vat = Math.round((o.total - net) * 100) / 100;
  const entries: LedgerEntry[] = [
    {
      id: `shopify:demo:${o.name}:revenue`,
      source: "shopify",
      kind: "revenue",
      occurredAt: o.createdAt,
      amount: net,
      currency: "USD",
      label: `Commande ${o.name}`,
      country: o.country,
      ref: o.name,
    },
  ];
  if (vat > 0) {
    entries.push({
      id: `shopify:demo:${o.name}:tax`,
      source: "shopify",
      kind: "tax_collected",
      occurredAt: o.createdAt,
      amount: vat,
      currency: "USD",
      label: `TVA collectée ${o.name}`,
      country: o.country,
      ref: o.name,
    });
  }
  return entries;
}

/** Écritures Shopify de démo sur ~14 jours (réelles pour aujourd'hui). */
export function sampleShopifyEntries(now = new Date("2026-09-13T17:00:00Z")): LedgerEntry[] {
  const all = [...REAL_TODAY, ...buildHistory(now, 14)];
  return all.flatMap(orderToEntries);
}

/** Dépense pub Meta de démo : ~120-260 USD/jour. */
export function sampleMetaEntries(now = new Date("2026-09-13T17:00:00Z")): LedgerEntry[] {
  const rand = rng(42);
  const entries: LedgerEntry[] = [];
  for (let d = 0; d <= 14; d++) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - d);
    const spend = Math.round((120 + rand() * 140) * 100) / 100;
    const date = day.toISOString().slice(0, 10);
    entries.push({
      id: `meta:demo:${date}`,
      source: "meta",
      kind: "ads",
      occurredAt: `${date}T12:00:00Z`,
      amount: -spend,
      currency: "USD",
      label: `Pub Meta ${date}`,
    });
  }
  return entries;
}
