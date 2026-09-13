// ---------------------------------------------------------------------------
// Modèle de données central de Crésus.
//
// Tout ce qui rentre depuis une source (Shopify, Printify, Qonto, Meta...) est
// converti en `LedgerEntry` : une écriture normalisée, positive pour une entrée
// d'argent, négative pour une sortie. Le moteur de P&L n'agrège QUE des
// LedgerEntry — il ne connaît pas les spécificités de chaque API.
// ---------------------------------------------------------------------------

export type SourceId =
  | "shopify"
  | "printify"
  | "prodigi"
  | "artelo"
  | "qonto"
  | "pennylane"
  | "meta";

/** Grande famille d'un flux, pour regrouper le compte de résultat. */
export type EntryKind =
  | "revenue" // CA (ventes)
  | "cogs" // coût de production des produits (POD)
  | "fulfillment" // frais d'impression / traitement
  | "shipping" // frais de port supportés
  | "ads" // dépense publicitaire (Meta...)
  | "fees" // frais de transaction / commissions plateforme
  | "tax_collected" // TVA collectée sur les ventes (dette, pas un revenu)
  | "refund" // remboursement client
  | "expense" // charge diverse (banque, abonnements...)
  | "other";

export type Currency = "EUR" | "USD" | "GBP" | string;

export interface LedgerEntry {
  /** Identifiant stable et déduplicable (ex: "shopify:order:123:line:456"). */
  id: string;
  source: SourceId;
  kind: EntryKind;
  /** Horodatage ISO 8601 UTC de l'événement financier. */
  occurredAt: string;
  /** Montant dans la devise d'origine. Positif = entrée, négatif = sortie. */
  amount: number;
  currency: Currency;
  /** Libellé lisible (nom de commande, campagne, fournisseur...). */
  label: string;
  /** Pays rattaché à l'écriture (ISO-3166 alpha-2), utile pour la TVA. */
  country?: string;
  /** Référence croisée (ex: n° de commande Shopify pour matcher un coût POD). */
  ref?: string;
  /** Données brutes utiles au debug / à l'audit, non utilisées par le moteur. */
  meta?: Record<string, unknown>;
}

/** Une écriture après conversion dans la devise de reporting. */
export interface NormalizedEntry extends LedgerEntry {
  /** Montant converti dans la devise de reporting (EUR par défaut). */
  amountBase: number;
  baseCurrency: Currency;
  /** Taux de change appliqué (1 unité devise d'origine = fxRate base). */
  fxRate: number;
}

/** Compte de résultat agrégé sur une fenêtre (jour, heure, période). */
export interface PnLBucket {
  /** Clé de la fenêtre : "2026-09-13" ou "2026-09-13T14" (heure UTC). */
  key: string;
  /** Début de la fenêtre en ISO UTC. */
  start: string;
  revenue: number;
  cogs: number;
  fulfillment: number;
  shipping: number;
  ads: number;
  fees: number;
  refunds: number;
  expenses: number;
  /** TVA collectée (mémo, exclue de la marge : c'est une dette). */
  taxCollected: number;
  /** Marge nette = revenue - cogs - fulfillment - shipping - ads - fees - refunds - expenses. */
  net: number;
  /** Nombre de commandes (écritures de type revenue distinctes par ref). */
  orders: number;
  currency: Currency;
}

export interface PnLReport {
  currency: Currency;
  /** Bucket agrégé sur toute la période demandée. */
  total: PnLBucket;
  /** Un bucket par jour, du plus ancien au plus récent. */
  daily: PnLBucket[];
  /** Un bucket par heure pour le jour ciblé (`focusDay`). */
  hourly: PnLBucket[];
  /** Jour ciblé pour la vue horaire (YYYY-MM-DD). */
  focusDay: string;
  /** Répartition par source sur la période. */
  bySource: Record<SourceId, { net: number; revenue: number; cost: number }>;
  /** État de chaque connecteur (branché ? en direct ? erreur ?). */
  sources: SourceStatus[];
  /** Projection fiscale sur la période. */
  tax: TaxProjection;
  /** true si le rapport utilise des données de démonstration (pas de clés API). */
  demo: boolean;
  generatedAt: string;
}

export interface SourceStatus {
  id: SourceId;
  label: string;
  /** "live" = clé présente et données réelles, "demo" = échantillon figé,
   *  "stub" = pas encore implémenté, "error" = clé présente mais échec. */
  state: "live" | "demo" | "stub" | "error";
  /** Message court (ex: "clé absente", "42 écritures", erreur API). */
  detail: string;
  entryCount: number;
}

export interface TaxProjection {
  currency: Currency;
  /** TVA collectée par pays sur la période (à reverser). */
  vatByCountry: { country: string; collected: number }[];
  vatTotal: number;
  /** Assiette du résultat (marge nette avant IS). */
  profitBase: number;
  /** Impôt sur les sociétés estimé sur la période. */
  corporateTaxEstimate: number;
  corporateTaxRate: number;
  notes: string[];
}
