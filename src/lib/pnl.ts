import type {
  LedgerEntry,
  NormalizedEntry,
  PnLBucket,
  PnLReport,
  SourceId,
  SourceStatus,
} from "./types";
import { connectors } from "./connectors";
import type { DateRange } from "./connectors/types";
import { getConverter } from "./fx";
import { projectTax } from "./tax";
import {
  BASE_CURRENCY,
  ESTIMATED_COGS_RATE,
  ESTIMATED_FULFILLMENT_RATE,
  PAYMENT_FEE_RATE,
  PAYMENT_FEE_FIXED,
  SOURCES,
} from "./config";
import { sampleShopifyEntries, sampleMetaEntries } from "./sample-data";

const REPORT_TZ = process.env.REPORT_TZ || "Europe/Paris";

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
function estimateCosts(entries: LedgerEntry[], hasRealCogs: boolean): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  // Frais de paiement (Shopify/passerelle) : toujours estimés à partir du CA.
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
      meta: { estimated: true },
    });
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

export interface BuildOptions {
  /** Nombre de jours d'historique (par défaut 14). */
  days?: number;
  /** Jour ciblé pour la vue horaire (YYYY-MM-DD). Défaut : aujourd'hui. */
  focusDay?: string;
}

export async function buildReport(opts: BuildOptions = {}): Promise<PnLReport> {
  const days = opts.days ?? 14;
  const now = new Date();
  const to = new Date(now.getTime() + 60_000); // marge pour inclure l'instant présent
  const from = new Date(now.getTime() - days * 86_400_000);
  const range: DateRange = { from: from.toISOString(), to: to.toISOString() };

  // 1) Récupération de toutes les sources.
  const raw: LedgerEntry[] = [];
  const statuses: SourceStatus[] = [];
  let anyLive = false;

  for (const c of connectors) {
    const meta = SOURCES.find((s) => s.id === c.id)!;
    const res = await c.fetch(range);
    if (res.state === "live") anyLive = true;
    raw.push(...res.entries);
    statuses.push({
      id: c.id,
      label: meta.label,
      state: res.state,
      detail: res.detail,
      entryCount: res.entries.length,
    });
  }

  // 2) Fallback démo si rien n'est branché en direct.
  let demo = false;
  if (!anyLive) {
    demo = true;
    const shop = sampleShopifyEntries();
    const meta = sampleMetaEntries();
    raw.push(...shop, ...meta);
    patchStatus(statuses, "shopify", "demo", `démo — ${shop.length} écritures (vraies commandes du jour)`);
    patchStatus(statuses, "meta", "demo", `démo — ${meta.length} jours de dépense`);
  }

  // 3) Coûts estimés (POD non branchés) + frais de paiement.
  const hasRealCogs = raw.some((e) => e.kind === "cogs" && !(e.meta?.estimated));
  const estimated = estimateCosts(raw, hasRealCogs);
  raw.push(...estimated);
  if (estimated.length > 0) {
    const anyEstCogs = estimated.some((e) => e.kind === "cogs");
    if (anyEstCogs) {
      patchStatus(statuses, "printify", undefined, "coûts POD estimés (branche Printify/Prodigi/Artelo pour le réel)", true);
    }
  }

  // 4) Conversion en devise de reporting.
  const fx = await getConverter();
  const normalized: NormalizedEntry[] = raw.map((e) => {
    const rate = fx.rate(e.currency);
    return { ...e, amountBase: e.amount * rate, baseCurrency: BASE_CURRENCY, fxRate: rate };
  });

  // 5) Agrégation par jour et par heure.
  const focusDay = opts.focusDay || todayLocal();
  const dailyMap = new Map<string, { b: PnLBucket; refs: Set<string> }>();
  const hourlyMap = new Map<number, { b: PnLBucket; refs: Set<string> }>();
  const total = emptyBucket("total", from.toISOString());
  const totalRefs = new Set<string>();
  const bySource = initBySource();

  for (const e of normalized) {
    const { day, hour } = localParts(e.occurredAt);

    // total
    addToBucket(total, e, totalRefs);

    // daily
    let dd = dailyMap.get(day);
    if (!dd) {
      dd = { b: emptyBucket(day, `${day}T00:00:00`), refs: new Set() };
      dailyMap.set(day, dd);
    }
    addToBucket(dd.b, e, dd.refs);

    // hourly (jour ciblé uniquement)
    if (day === focusDay) {
      let hh = hourlyMap.get(hour);
      if (!hh) {
        hh = { b: emptyBucket(`${focusDay}T${String(hour).padStart(2, "0")}`, `${focusDay}T${String(hour).padStart(2, "0")}:00:00`), refs: new Set() };
        hourlyMap.set(hour, hh);
      }
      addToBucket(hh.b, e, hh.refs);
    }

    // par source
    accBySource(bySource, e);
  }

  finalizeBucket(total, totalRefs.size);

  const daily = [...dailyMap.values()]
    .map(({ b, refs }) => {
      finalizeBucket(b, refs.size);
      return b;
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  // 24 heures pleines pour le jour ciblé (les heures vides restent à zéro).
  const hourly: PnLBucket[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = hourlyMap.get(h);
    const key = `${focusDay}T${String(h).padStart(2, "0")}`;
    if (hh) {
      finalizeBucket(hh.b, hh.refs.size);
      hourly.push(hh.b);
    } else {
      hourly.push(emptyBucket(key, `${key}:00:00`));
    }
  }

  const tax = projectTax(normalized, total.net);

  return {
    currency: BASE_CURRENCY,
    total,
    daily,
    hourly,
    focusDay,
    bySource,
    sources: statuses,
    tax,
    demo,
    generatedAt: new Date().toISOString(),
  };
}

// --- Helpers -----------------------------------------------------------------

function initBySource(): PnLReport["bySource"] {
  const obj = {} as PnLReport["bySource"];
  for (const s of SOURCES) obj[s.id] = { net: 0, revenue: 0, cost: 0 };
  return obj;
}

function accBySource(acc: PnLReport["bySource"], e: NormalizedEntry): void {
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
