import type {
  BySource,
  ConversionFeeLine,
  ConversionFeeMonth,
  ConversionFeeReport,
  ConversionFeeSlice,
  LedgerEntry,
  RoasStats,
  NormalizedEntry,
  PeriodKey,
  PeriodSlice,
  PnLBucket,
  PnLReport,
  Reconciliation,
  RegionBreak,
  SourceId,
  SourceStatus,
} from "./types";
import { connectors } from "./connectors";
import type { DateRange } from "./connectors/types";
import { getConverter } from "./fx";
import { projectTax } from "./tax";
import {
  BASE_CURRENCY,
  COST_BASIS,
  ESTIMATED_COGS_RATE,
  ESTIMATED_FULFILLMENT_RATE,
  FX_FEE_RATE,
  PAYMENT_FEE_RATE,
  PAYMENT_FEE_FIXED,
  SOURCES,
} from "./config";
import { sampleShopifyEntries, sampleMetaEntries } from "./sample-data";

const REPORT_TZ = process.env.REPORT_TZ || "Europe/Paris";

// Délai max accordé à chaque connecteur (garde la page sous le timeout Vercel).
const CONNECTOR_TIMEOUT_MS = Number(process.env.CONNECTOR_TIMEOUT_MS ?? 15000);

/** Renvoie `fallback` si la promesse n'a pas résolu avant `ms` millisecondes. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (v) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      }
    );
  });
}

// --- Découpage temporel dans le fuseau de reporting (Europe/Paris) -----------

function localParts(iso: string): { day: string; hour: number } {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return { day: `${p.year}-${p.month}-${p.day}`, hour };
}

function todayLocal(): string {
  return localParts(new Date().toISOString()).day;
}

// --- Estimation des coûts tant que les fournisseurs POD ne sont pas branchés --

/**
 * Génère des écritures de COÛT estimées à partir du CA, quand aucun coût réel
 * n'est disponible (Printify/Prodigi/Artelo non branchés). Toujours marquées
 * `meta.estimated = true` pour être distinguées dans l'UI.
 */
function estimateCosts(entries: LedgerEntry[], hasRealCogs: boolean, hasRealFees: boolean): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  // Frais de paiement : estimés depuis le CA UNIQUEMENT si Shopify ne fournit
  // pas les frais réels (transactions.fees).
  const revByOrder = new Map<string, { net: number; ttc: number; at: string; ccy: string }>();
  for (const e of entries) {
    if (e.source !== "shopify") continue;
    const key = e.ref || e.id;
    const cur = revByOrder.get(key) || { net: 0, ttc: 0, at: e.occurredAt, ccy: e.currency };
    if (e.kind === "revenue") {
      cur.net += e.amount;
      cur.ttc += e.amount;
    } else if (e.kind === "tax_collected") {
      cur.ttc += e.amount;
    }
    revByOrder.set(key, cur);
  }

  for (const [ref, o] of revByOrder) {
    if (!hasRealFees) {
      const fee = o.ttc * PAYMENT_FEE_RATE + PAYMENT_FEE_FIXED;
      out.push({
        id: `est:fee:${ref}`,
        source: "shopify",
        kind: "fees",
        occurredAt: o.at,
        amount: -round2(fee),
        currency: o.ccy,
        label: `Frais paiement (est.) ${ref}`,
        ref,
        meta: { estimated: true, feeType: "payments" },
      });
    }
    if (!hasRealCogs) {
      out.push({
        id: `est:cogs:${ref}`,
        source: "printify",
        kind: "cogs",
        occurredAt: o.at,
        amount: -round2(o.net * ESTIMATED_COGS_RATE),
        currency: o.ccy,
        label: `Coût prod. POD (est.) ${ref}`,
        ref,
        meta: { estimated: true },
      });
      out.push({
        id: `est:ful:${ref}`,
        source: "printify",
        kind: "fulfillment",
        occurredAt: o.at,
        amount: -round2(o.net * ESTIMATED_FULFILLMENT_RATE),
        currency: o.ccy,
        label: `Expédition POD (est.) ${ref}`,
        ref,
        meta: { estimated: true },
      });
    }
  }
  return out;
}

// --- Politique de coût : évite le double comptage entre les sources ----------

/**
 * Marque `reconcileOnly` sur les écritures qui NE doivent PAS entrer dans la
 * marge nette, selon COST_BASIS, pour ne pas compter deux fois la même dépense.
 * - "connectors" : Pennylane (compta) + Qonto (banque) = rapprochement.
 * - "pennylane"  : POD granulaire + Meta + Qonto = rapprochement ; Pennylane
 *   pilote les charges (les revenus Shopify restent comptés normalement).
 */
function applyCostBasis(entries: LedgerEntry[]): void {
  for (const e of entries) {
    // Qonto est TOUJOURS un miroir bancaire de rapprochement (jamais la marge),
    // quel que soit le mode et le sens (entrée ou sortie).
    if (e.source === "qonto") {
      e.reconcileOnly = true;
      continue;
    }
    if (COST_BASIS === "connectors") {
      if (e.source === "pennylane") e.reconcileOnly = true;
    } else {
      const granularCost =
        e.source === "printify" || e.source === "prodigi" || e.source === "artelo" || e.source === "meta";
      if (granularCost && e.kind !== "revenue") e.reconcileOnly = true;
    }
  }
}

// --- Agrégation --------------------------------------------------------------

function emptyBucket(key: string, start: string): PnLBucket {
  return {
    key,
    start,
    revenue: 0,
    cogs: 0,
    fulfillment: 0,
    shipping: 0,
    ads: 0,
    fees: 0,
    refunds: 0,
    expenses: 0,
    taxCollected: 0,
    net: 0,
    orders: 0,
    currency: BASE_CURRENCY,
  };
}

function addToBucket(b: PnLBucket, e: NormalizedEntry, orderRefs: Set<string>): void {
  const v = e.amountBase;
  switch (e.kind) {
    case "revenue":
      b.revenue += v;
      if (e.ref) orderRefs.add(e.ref);
      break;
    case "cogs":
      b.cogs += -v;
      break;
    case "fulfillment":
      b.fulfillment += -v;
      break;
    case "shipping":
      b.shipping += -v;
      break;
    case "ads":
      b.ads += -v;
      break;
    case "fees":
      b.fees += -v;
      break;
    case "refund":
      b.refunds += -v;
      break;
    case "expense":
      b.expenses += -v;
      break;
    case "tax_collected":
      b.taxCollected += v;
      break;
    default:
      break;
  }
}

function finalizeBucket(b: PnLBucket, orderCount: number): void {
  b.orders = orderCount;
  b.net = round2(
    b.revenue - b.cogs - b.fulfillment - b.shipping - b.ads - b.fees - b.refunds - b.expenses
  );
  b.revenue = round2(b.revenue);
  b.cogs = round2(b.cogs);
  b.fulfillment = round2(b.fulfillment);
  b.shipping = round2(b.shipping);
  b.ads = round2(b.ads);
  b.fees = round2(b.fees);
  b.refunds = round2(b.refunds);
  b.expenses = round2(b.expenses);
  b.taxCollected = round2(b.taxCollected);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Point d'entrée principal ------------------------------------------------

// --- Cache des données (partie lourde : appels API) --------------------------

const DATA_TTL_MS = Number(process.env.DATA_TTL_MS ?? 180_000); // 3 min
let dataCache: {
  at: number;
  normalized: NormalizedEntry[];
  statuses: SourceStatus[];
  demo: boolean;
} | null = null;

/** Récupère + normalise 30 jours d'écritures (avec cache mémoire). */
async function getData(): Promise<NonNullable<typeof dataCache>> {
  if (dataCache && Date.now() - dataCache.at < DATA_TTL_MS) return dataCache;

  const now = new Date();
  const to = new Date(now.getTime() + 60_000);
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const range: DateRange = { from: from.toISOString(), to: to.toISOString() };

  // 1) Toutes les sources en parallèle, avec timeout par connecteur.
  const raw: LedgerEntry[] = [];
  const statuses: SourceStatus[] = [];
  let anyLive = false;
  const results = await Promise.all(
    connectors.map(async (c) => {
      const meta = SOURCES.find((s) => s.id === c.id)!;
      const res = await withTimeout(c.fetch(range), CONNECTOR_TIMEOUT_MS, {
        entries: [],
        state: "error" as const,
        detail: `délai dépassé (>${Math.round(CONNECTOR_TIMEOUT_MS / 1000)}s)`,
      });
      return { meta, res };
    })
  );
  for (const { meta, res } of results) {
    if (res.state === "live") anyLive = true;
    raw.push(...res.entries);
    statuses.push({ id: meta.id, label: meta.label, state: res.state, detail: res.detail, entryCount: res.entries.length });
  }

  // 2) Fallback démo si rien n'est branché.
  let demo = false;
  if (!anyLive) {
    demo = true;
    const shop = sampleShopifyEntries();
    const meta = sampleMetaEntries();
    raw.push(...shop, ...meta);
    patchStatus(statuses, "shopify", "demo", `démo — ${shop.length} écritures (vraies commandes du jour)`);
    patchStatus(statuses, "meta", "demo", `démo — ${meta.length} jours de dépense`);
  }

  // 3) Coûts estimés (POD non branchés) + frais de paiement (base "connectors").
  if (COST_BASIS === "connectors") {
    const hasRealCogs = raw.some((e) => e.kind === "cogs" && !e.meta?.estimated);
    const hasRealFees = raw.some((e) => e.kind === "fees" && !e.meta?.estimated);
    const estimated = estimateCosts(raw, hasRealCogs, hasRealFees);
    raw.push(...estimated);
    if (estimated.some((e) => e.kind === "cogs")) {
      patchStatus(statuses, "printify", undefined, "coûts POD estimés (branche Printify/Prodigi/Artelo pour le réel)", true);
    }
  }

  // 3bis) Politique de coût (anti double comptage).
  applyCostBasis(raw);

  // 4) Conversion en devise de reporting.
  const fx = await getConverter();
  const normalized: NormalizedEntry[] = raw.map((e) => {
    const rate = fx.rate(e.currency);
    return { ...e, amountBase: e.amount * rate, baseCurrency: BASE_CURRENCY, fxRate: rate };
  });

  // 5) Rattachement de la région des coûts POD qui n'ont pas de pays natif :
  //    on le déduit de la commande Shopify correspondante. Le matching essaie
  //    plusieurs clés (référence normalisée, chiffres seuls, ID legacy Shopify)
  //    car chaque fournisseur nomme la référence différemment.
  const countryByRef = new Map<string, string>();
  const addKey = (k: string | undefined, country: string) => {
    if (k) countryByRef.set(k, country);
  };
  for (const e of normalized) {
    if (e.kind === "revenue" && e.country) {
      if (e.ref) {
        addKey(normRef(e.ref), e.country);
        addKey(digitsOnly(e.ref), e.country);
      }
      const legacy = e.meta?.legacyId;
      if (typeof legacy === "string") addKey(legacy, e.country);
    }
  }
  const lookup = (ref: string): string | undefined =>
    countryByRef.get(normRef(ref)) || countryByRef.get(digitsOnly(ref));
  for (const e of normalized) {
    if (!e.country && e.ref && (e.kind === "cogs" || e.kind === "fulfillment" || e.kind === "shipping")) {
      const c = lookup(e.ref);
      if (c) e.country = c;
    }
  }

  dataCache = { at: Date.now(), normalized, statuses, demo };
  return dataCache;
}

/** Normalise une référence de commande pour le matching (#4683 -> 4683). */
function normRef(ref: string): string {
  return ref.trim().replace(/^#/, "").toLowerCase();
}
/** Ne garde que les chiffres d'une référence (utile pour matcher les numéros). */
function digitsOnly(ref: string): string {
  return ref.replace(/\D/g, "");
}

// --- Régions -----------------------------------------------------------------

const EU_COUNTRIES = new Set([
  "FR", "DE", "IT", "ES", "BE", "NL", "AT", "PT", "IE", "LU", "FI", "GR", "SK", "SI",
  "EE", "LV", "LT", "CY", "MT", "HR", "BG", "RO", "HU", "PL", "CZ", "DK", "SE",
]);

// Certains fournisseurs (Printify) renvoient le NOM complet du pays au lieu du
// code ISO — on normalise pour un classement fiable des régions.
const NAME_TO_ISO: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", "u.s.a.": "US",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB",
  france: "FR", germany: "DE", italy: "IT", spain: "ES", belgium: "BE", netherlands: "NL",
  austria: "AT", portugal: "PT", ireland: "IE", luxembourg: "LU", finland: "FI", greece: "GR",
  sweden: "SE", denmark: "DK", poland: "PL", czechia: "CZ", "czech republic": "CZ", romania: "RO",
  hungary: "HU", croatia: "HR", bulgaria: "BG", slovakia: "SK", slovenia: "SI", estonia: "EE",
  latvia: "LV", lithuania: "LT", cyprus: "CY", malta: "MT",
  canada: "CA", australia: "AU", switzerland: "CH", norway: "NO", "new zealand": "NZ",
};

function toIso(country?: string): string | undefined {
  if (!country) return undefined;
  const c = country.trim();
  if (c.length === 2) return c.toUpperCase();
  return NAME_TO_ISO[c.toLowerCase()] || c.toUpperCase();
}

function regionOf(country?: string): string {
  const iso = toIso(country);
  if (!iso) return "Autres";
  if (iso === "US") return "US";
  if (iso === "GB") return "UK";
  if (EU_COUNTRIES.has(iso)) return "EU";
  return "Autres";
}

// --- Helpers d'agrégation par période ---------------------------------------

/** Décale une clé de jour "YYYY-MM-DD" de `delta` jours. */
function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

interface Dated {
  e: NormalizedEntry;
  day: string;
}

function aggregatePeriod(
  dated: Dated[],
  key: PeriodKey | "custom",
  label: string,
  pred: (d: string) => boolean
): PeriodSlice {
  const bucket = emptyBucket(key, new Date().toISOString());
  const refs = new Set<string>();
  const bySource = initBySource();
  const inWindow: NormalizedEntry[] = [];
  for (const { e, day } of dated) {
    if (!pred(day)) continue;
    inWindow.push(e);
    if (e.reconcileOnly) continue; // hors marge
    addToBucket(bucket, e, refs);
    accBySource(bySource, e);
  }
  finalizeBucket(bucket, refs.size);
  const tax = projectTax(inWindow, bucket.net);
  const conversionFee = conversionFeeFor(dated, pred);
  const roas = roasFor(bucket, conversionFee.total);
  return { key, label, bucket, bySource, tax, conversionFee, roas };
}

/**
 * ROAS d'équilibre (break-even) et ROAS constaté.
 * - Marge de contribution avant pub = CA − coûts variables hors pub
 *   (impression, cadres, livraison, frais Shopify, frais de change, remboursements).
 *   Les charges fixes (expenses : salaires, loyer…) sont EXCLUES : le ROAS BE
 *   mesure la rentabilité produit, pas la couverture des frais de structure.
 * - ROAS BE = 1 / taux de marge : le CA qu'il faut générer par € de pub pour
 *   que la pub s'autofinance.
 * - ROAS constaté = CA total / dépense pub (blended / MER, toutes ventes
 *   confondues — on n'a pas d'attribution par campagne).
 */
function roasFor(b: PnLBucket, conversionFeeTotal: number): RoasStats {
  const revenue = b.revenue;
  const variableCosts = round2(b.cogs + b.fulfillment + b.shipping + b.fees + b.refunds + conversionFeeTotal);
  const contributionMargin = round2(revenue - variableCosts);
  const marginRate = revenue > 0 ? contributionMargin / revenue : 0;
  const breakEven = marginRate > 0 ? round2(1 / marginRate) : null;
  const actual = b.ads > 0 ? round2(revenue / b.ads) : null;
  return {
    currency: BASE_CURRENCY,
    revenue,
    adSpend: b.ads,
    variableCosts,
    contributionMargin,
    marginRate: round2(marginRate * 1000) / 1000,
    breakEven,
    actual,
  };
}

function reconcileSums(
  dated: Dated[],
  pred: (d: string) => boolean
): { accounting: number; bankOut: number; bankIn: number } {
  let accounting = 0;
  let bankOut = 0;
  let bankIn = 0;
  for (const { e, day } of dated) {
    if (!pred(day) || !e.reconcileOnly) continue;
    if (e.source === "pennylane" && e.amountBase < 0) accounting += -e.amountBase;
    if (e.source === "qonto") {
      if (e.amountBase < 0) bankOut += -e.amountBase;
      else bankIn += e.amountBase;
    }
  }
  return { accounting: round2(accounting), bankOut: round2(bankOut), bankIn: round2(bankIn) };
}

type FeeAcc = { payments: number; currency: number; vat: number; other: number };

function buildDailyBuckets(dated: Dated[], n: number, today: string): PnLBucket[] {
  const map = new Map<
    string,
    { b: PnLBucket; refs: Set<string>; reg: Map<string, RegionBreak>; fees: FeeAcc }
  >();
  for (let i = n - 1; i >= 0; i--) {
    const d = shiftDay(today, -i);
    map.set(d, {
      b: emptyBucket(d, `${d}T00:00:00`),
      refs: new Set(),
      reg: new Map(),
      fees: { payments: 0, currency: 0, vat: 0, other: 0 },
    });
  }
  for (const { e, day } of dated) {
    if (e.reconcileOnly) continue;
    const slot = map.get(day);
    if (!slot) continue;
    addToBucket(slot.b, e, slot.refs);

    // Ventilation régionale (hors pub, qui n'a pas de pays).
    const v = e.amountBase;
    const r = regionOf(e.country);
    const rb = slot.reg.get(r) || { region: r, revenue: 0, print: 0, frames: 0, shipping: 0, taxes: 0 };
    if (e.kind === "revenue") rb.revenue += v;
    else if (e.kind === "cogs") {
      // Artelo = cadres ; Printify/Prodigi = impression (prints).
      if (e.source === "artelo") rb.frames += -v;
      else rb.print += -v;
    } else if (e.kind === "fulfillment" || e.kind === "shipping") rb.shipping += -v;
    else if (e.kind === "tax_collected") rb.taxes += v;
    else if (e.kind === "fees") rb.taxes += -v;
    slot.reg.set(r, rb);

    // Détail des frais Shopify par type.
    if (e.kind === "fees") {
      const t = (e.meta?.feeType as keyof FeeAcc) || "other";
      if (t in slot.fees) slot.fees[t] += -v;
      else slot.fees.other += -v;
    }
  }
  return [...map.values()]
    .map(({ b, refs, reg, fees }) => {
      finalizeBucket(b, refs.size);
      b.feeBreakdown = {
        payments: round2(fees.payments),
        currency: round2(fees.currency),
        vat: round2(fees.vat),
        other: round2(fees.other),
      };
      const order: Record<string, number> = { US: 0, UK: 1, EU: 2, Autres: 3 };
      b.regions = [...reg.values()]
        .map((r) => ({
          region: r.region,
          revenue: round2(r.revenue),
          print: round2(r.print),
          frames: round2(r.frames),
          shipping: round2(r.shipping),
          taxes: round2(r.taxes),
        }))
        .filter((r) => r.revenue !== 0 || r.print !== 0 || r.frames !== 0 || r.shipping !== 0 || r.taxes !== 0)
        .sort((a, b) => (order[a.region] ?? 9) - (order[b.region] ?? 9));
      return b;
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

// --- Frais de conversion de devise (spread carte/banque) ---------------------

// Sources potentiellement réglées en USD (Artelo & Printify surtout). Le taux
// de change n'est appliqué QUE sur les factures en USD : c'est la banque qui
// applique son taux lors du règlement carte. Les factures déjà en EUR (Qonto,
// Pennylane) et Shopify (frais de change à l'encaissement déjà remontés en
// réel) sont exclus. Prodigi (GBP) n'entre pas dans ce calcul.
const FX_COST_SOURCES: SourceId[] = ["artelo", "printify", "prodigi", "meta"];

// Devise sur laquelle la banque applique un taux de conversion à la charge.
const FX_FEE_CURRENCY = "USD";

/**
 * Calcule les frais de conversion USD -> EUR estimés sur une fenêtre (prédicat
 * sur le jour). Uniquement les dépenses (sorties) facturées en USD ; le spread
 * bancaire est modélisé par FX_FEE_RATE appliqué au montant converti en EUR.
 */
function conversionFeeFor(dated: Dated[], pred: (d: string) => boolean): ConversionFeeSlice {
  const bySource: Partial<Record<SourceId, ConversionFeeLine>> = {};
  for (const { e, day } of dated) {
    if (!pred(day)) continue;
    if (e.currency !== FX_FEE_CURRENCY) continue; // taux banque : factures en $ seulement
    if (!FX_COST_SOURCES.includes(e.source)) continue;
    if (e.amountBase >= 0) continue; // seules les sorties (dépenses)
    const cur = bySource[e.source] ?? { currency: e.currency, spendBase: 0, fee: 0 };
    cur.spendBase += -e.amountBase;
    bySource[e.source] = cur;
  }
  let total = 0;
  for (const k of Object.keys(bySource) as SourceId[]) {
    const l = bySource[k]!;
    l.spendBase = round2(l.spendBase);
    l.fee = round2(l.spendBase * FX_FEE_RATE);
    total += l.fee;
  }
  return { currency: BASE_CURRENCY, feeRate: FX_FEE_RATE, total: round2(total), bySource };
}

/** Ordre d'affichage : Artelo en tête (le plus concerné), puis les autres. */
function fxSourceOrder(id: SourceId): number {
  const order: Partial<Record<SourceId, number>> = { artelo: 0, printify: 1, prodigi: 2, meta: 3 };
  return order[id] ?? 9;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  const s = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Estime les frais de conversion $/£ -> € que l'on paie réellement quand la
 * carte règle une facture en devise étrangère. Le taux mid-market (fx.ts) ne
 * modélise pas ce spread : on applique FX_FEE_RATE sur la dépense convertie,
 * agrégée par mois civil et par source (Artelo en priorité).
 */
function buildConversionFees(dated: Dated[]): ConversionFeeReport {
  // month -> source -> { currency, spendBase }
  const acc = new Map<string, Map<SourceId, { currency: string; spendBase: number }>>();
  for (const { e, day } of dated) {
    if (!FX_COST_SOURCES.includes(e.source)) continue;
    if (e.currency !== FX_FEE_CURRENCY) continue; // taux banque : factures en $ seulement
    if (e.amountBase >= 0) continue; // seules les sorties (dépenses) sont converties
    const month = day.slice(0, 7);
    const bySource = acc.get(month) ?? new Map();
    const cur = bySource.get(e.source) ?? { currency: e.currency, spendBase: 0 };
    cur.spendBase += -e.amountBase; // valeur absolue de la dépense en EUR
    bySource.set(e.source, cur);
    acc.set(month, bySource);
  }

  const months: ConversionFeeMonth[] = [...acc.entries()]
    .map(([month, bySource]) => {
      const lines: Partial<Record<SourceId, ConversionFeeLine>> = {};
      let total = 0;
      for (const [src, { currency, spendBase }] of bySource) {
        const fee = round2(spendBase * FX_FEE_RATE);
        lines[src] = { currency, spendBase: round2(spendBase), fee };
        total += fee;
      }
      return { month, label: monthLabel(month), bySource: lines, total: round2(total), currency: BASE_CURRENCY };
    })
    .sort((a, b) => b.month.localeCompare(a.month)); // plus récent en premier

  const notes = [
    `Estimation : ${(FX_FEE_RATE * 100).toFixed(1)} % de marge de change sur chaque facture en USD (ajustable via FX_FEE_RATE).`,
    "Le taux n'est appliqué que sur les factures en $ — c'est la banque qui applique son taux au règlement.",
    "Assiette = dépense convertie en EUR au taux mid-market ; le spread réel dépend de votre banque.",
  ];

  return {
    feeRate: FX_FEE_RATE,
    sources: [...FX_COST_SOURCES].sort((a, b) => fxSourceOrder(a) - fxSourceOrder(b)),
    months,
    currency: BASE_CURRENCY,
    notes,
  };
}

// --- Diagnostic --------------------------------------------------------------

/** Échantillon pour comprendre le rattachement pays des coûts POD. */
export async function debugSample() {
  const { normalized, statuses } = await getData();
  const shopify = normalized
    .filter((e) => e.source === "shopify" && e.kind === "revenue")
    .slice(0, 8)
    .map((e) => ({ ref: e.ref, legacyId: e.meta?.legacyId, country: e.country }));
  const bySource: Record<string, unknown[]> = {};
  for (const src of ["printify", "prodigi", "artelo"]) {
    bySource[src] = normalized
      .filter((e) => e.source === src && (e.kind === "cogs" || e.kind === "fulfillment"))
      .slice(0, 6)
      .map((e) => ({ kind: e.kind, ref: e.ref, country: e.country || "(aucun)", amount: Math.round(e.amountBase) }));
  }
  // Top bénéficiaires Qonto (sorties) — pour identifier Prodigi/Printify/etc.
  const qontoByName = new Map<string, number>();
  for (const e of normalized) {
    if (e.source === "qonto" && e.kind === "expense") {
      const name = e.label || "?";
      qontoByName.set(name, (qontoByName.get(name) ?? 0) + -e.amountBase);
    }
  }
  const qontoTop = [...qontoByName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, total]) => ({ name, total: Math.round(total) }));

  return {
    sources: statuses.map((s) => ({ id: s.id, state: s.state, entries: s.entryCount, detail: s.detail })),
    shopifySamples: shopify,
    costSamples: bySource,
    qontoTop,
  };
}

// --- Point d'entrée ----------------------------------------------------------

export async function buildReport(): Promise<PnLReport> {
  const { normalized, statuses, demo } = await getData();
  const dated: Dated[] = normalized.map((e) => ({ e, day: localParts(e.occurredAt).day }));

  const today = todayLocal();
  const from = (n: number) => shiftDay(today, -(n - 1)); // fenêtre de n jours incluant aujourd'hui

  const daily = buildDailyBuckets(dated, 30, today);

  const periods: Record<PeriodKey, PeriodSlice> = {
    day: aggregatePeriod(dated, "day", "Aujourd'hui", (d) => d === today),
    week: aggregatePeriod(dated, "week", "7 jours", (d) => d >= from(7)),
    d14: aggregatePeriod(dated, "d14", "14 jours", (d) => d >= from(14)),
    d30: aggregatePeriod(dated, "d30", "30 jours", (d) => d >= from(30)),
  };

  // Rapprochement sur 30 jours.
  const b30 = periods.d30.bucket;
  const opCosts = round2(b30.cogs + b30.fulfillment + b30.shipping + b30.ads + b30.fees + b30.expenses + b30.refunds);
  const rec = reconcileSums(dated, (d) => d >= from(30));
  const reconciliation = buildReconciliation(opCosts, rec.accounting, rec.bankOut, rec.bankIn, statuses);

  // Frais de conversion de devise (spread), agrégés par mois civil.
  const conversionFees = buildConversionFees(dated);

  // Taux EUR -> USD (fx.rate("USD") = EUR par USD).
  const fx = await getConverter();
  const usdEur = fx.rate("USD");
  const usdPerEur = usdEur > 0 ? round2(1 / usdEur) : 1.08;

  return {
    currency: BASE_CURRENCY,
    usdPerEur,
    daily,
    periods,
    sources: statuses,
    reconciliation,
    conversionFees,
    demo,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Agrège une période PERSO définie par deux jours (YYYY-MM-DD) inclus, à partir
 * des mêmes données mises en cache. Réutilise l'agrégation standard (KPI, par
 * source, TVA, frais de conversion) — utilisé par /api/pnl?from=&to=.
 */
export async function buildCustomSlice(fromDay: string, toDay: string): Promise<PeriodSlice> {
  const { normalized } = await getData();
  const dated: Dated[] = normalized.map((e) => ({ e, day: localParts(e.occurredAt).day }));
  const [lo, hi] = fromDay <= toDay ? [fromDay, toDay] : [toDay, fromDay];
  const slice = aggregatePeriod(dated, "custom", "Période perso", (d) => d >= lo && d <= hi);
  slice.range = { from: lo, to: hi };
  return slice;
}

function buildReconciliation(
  operationalCosts: number,
  accountingExpenses: number,
  bankOutflows: number,
  bankInflows: number,
  statuses: SourceStatus[]
): Reconciliation {
  const pennylaneLive = statuses.find((s) => s.id === "pennylane")?.state === "live";
  const qontoLive = statuses.find((s) => s.id === "qonto")?.state === "live";
  const notes: string[] = [];
  if (COST_BASIS === "connectors") {
    notes.push("Marge pilotée par les coûts granulaires (POD par commande + Meta).");
    notes.push(
      pennylaneLive
        ? "Pennylane recoupe les charges comptabilisées — un écart signale un coût manquant côté connecteurs."
        : "Branche Pennylane pour recouper automatiquement avec la compta."
    );
  } else {
    notes.push("Marge pilotée par les charges comptabilisées dans Pennylane.");
    notes.push("Les connecteurs POD/Meta servent ici de repère détaillé.");
  }
  if (qontoLive) {
    notes.push("Qonto = tout ce qui passe réellement en banque (entrées + sorties), encaissements décalés inclus.");
  }
  return {
    costBasis: COST_BASIS,
    operationalCosts,
    accountingExpenses,
    bankOutflows,
    bankInflows,
    gap: round2(operationalCosts - accountingExpenses),
    currency: BASE_CURRENCY,
    notes,
  };
}

// --- Helpers -----------------------------------------------------------------

function initBySource(): BySource {
  const obj = {} as BySource;
  for (const s of SOURCES) obj[s.id] = { net: 0, revenue: 0, cost: 0 };
  return obj;
}

function accBySource(acc: BySource, e: NormalizedEntry): void {
  const s = acc[e.source];
  if (!s) return;
  if (e.kind === "tax_collected") return; // dette, hors marge
  if (e.kind === "revenue") s.revenue += e.amountBase;
  else if (e.amountBase < 0) s.cost += -e.amountBase;
  s.net = round2(s.revenue - s.cost);
  s.revenue = round2(s.revenue);
  s.cost = round2(s.cost);
}

function patchStatus(
  list: SourceStatus[],
  id: SourceId,
  state: SourceStatus["state"] | undefined,
  detail: string,
  onlyIfStub = false
): void {
  const s = list.find((x) => x.id === id);
  if (!s) return;
  if (onlyIfStub && s.state !== "stub") return;
  if (state) s.state = state;
  s.detail = detail;
}
