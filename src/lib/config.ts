import type { Currency, SourceId } from "./types";

// ---------------------------------------------------------------------------
// Configuration centrale, pilotée par variables d'environnement (Vercel).
// Aucune clé n'est écrite en dur ici — voir .env.example.
// ---------------------------------------------------------------------------

/** Devise de reporting pour dire « journée rentable ou pas ». */
export const BASE_CURRENCY: Currency = (process.env.REPORTING_CURRENCY as Currency) || "EUR";

/**
 * Taux de TVA par défaut par pays (ISO-3166 alpha-2), en fraction.
 * Utilisés quand la source ne fournit pas la taxe réelle. Le régime OSS de l'UE
 * fait qu'on collecte la TVA du pays de destination — d'où le détail par pays.
 */
export const VAT_RATES: Record<string, number> = {
  FR: 0.2,
  DE: 0.19,
  IT: 0.22,
  ES: 0.21,
  BE: 0.21,
  NL: 0.21,
  LU: 0.17,
  AT: 0.2,
  PT: 0.23,
  IE: 0.23,
  US: 0.0, // pas de TVA fédérale ; sales tax gérée à part si besoin
  GB: 0.2,
  CH: 0.081,
};

/** Taux d'impôt sur les sociétés utilisé pour la projection (France). */
export const CORPORATE_TAX_RATE = Number(process.env.CORPORATE_TAX_RATE ?? 0.25);

/**
 * Source des COÛTS pour la marge nette, afin d'éviter le double comptage.
 * - "connectors" (défaut) : la marge jour/heure s'appuie sur les coûts
 *   granulaires (POD par commande + Meta). Pennylane (compta) et Qonto (banque)
 *   servent de RAPPROCHEMENT : ils recoupent le total, sans être re-sommés.
 * - "pennylane" : Pennylane (charges comptabilisées) pilote les coûts ; les
 *   connecteurs POD/Meta/Qonto deviennent de simples repères de rapprochement.
 */
export const COST_BASIS = (process.env.COST_BASIS as "connectors" | "pennylane") || "connectors";

/**
 * Coût de production estimé (POD) tant que Printify/Prodigi/Artelo ne sont pas
 * branchés. Ratio appliqué au CA HT. À remplacer par les coûts réels par
 * commande dès que les connecteurs fournisseurs renvoient des données live.
 */
export const ESTIMATED_COGS_RATE = Number(process.env.ESTIMATED_COGS_RATE ?? 0.28);
export const ESTIMATED_FULFILLMENT_RATE = Number(process.env.ESTIMATED_FULFILLMENT_RATE ?? 0.06);

/** Frais de transaction Shopify Basic + passerelle (approx.), ratio du CA TTC. */
export const PAYMENT_FEE_RATE = Number(process.env.PAYMENT_FEE_RATE ?? 0.029);
export const PAYMENT_FEE_FIXED = Number(process.env.PAYMENT_FEE_FIXED ?? 0.3); // par commande, en base currency

/**
 * Marge de change (spread) appliquée par la banque/carte quand on paie une
 * facture dans une devise ≠ EUR (Artelo & Printify en USD, Prodigi en GBP).
 * Le taux mid-market (fx.ts) ne modélise PAS ce coût : on l'estime ici en
 * pourcentage du montant converti. 2 % couvre le mark-up carte typique
 * (Visa/Mastercard ~1 % + marge banque). Ajustable via FX_FEE_RATE.
 */
export const FX_FEE_RATE = Number(process.env.FX_FEE_RATE ?? 0.02);

export interface SourceMeta {
  id: SourceId;
  label: string;
  /** Nom de la/les variable(s) d'env attendues pour passer en "live". */
  envKeys: string[];
}

export const SOURCES: SourceMeta[] = [
  { id: "shopify", label: "Shopify", envKeys: ["SHOPIFY_SHOP", "SHOPIFY_ADMIN_TOKEN"] },
  { id: "printify", label: "Printify", envKeys: ["PRINTIFY_API_TOKEN"] },
  { id: "prodigi", label: "Prodigi", envKeys: ["PRODIGI_API_KEY"] },
  { id: "artelo", label: "Artelo", envKeys: ["ARTELO_API_KEY"] },
  { id: "qonto", label: "Qonto", envKeys: ["QONTO_LOGIN", "QONTO_SECRET_KEY"] },
  { id: "pennylane", label: "Pennylane", envKeys: ["PENNYLANE_API_TOKEN"] },
  { id: "meta", label: "Meta Ads", envKeys: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"] },
];

export function hasEnv(keys: string[]): boolean {
  return keys.every((k) => !!process.env[k] && process.env[k]!.trim().length > 0);
}
