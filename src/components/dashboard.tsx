import type { PnLBucket, BySource, SourceStatus, TaxProjection, Reconciliation, PeriodKey, RegionBreak, ConversionFeeReport, ConversionFeeSlice, RoasStats } from "@/lib/types";
import { money, pct, usd, dayLabel, signedClass } from "@/lib/format";

export type PeriodChoice = PeriodKey | "custom";

const REGION_LABELS: Record<string, string> = {
  US: "🇺🇸 États-Unis", UK: "🇬🇧 Royaume-Uni", EU: "🇪🇺 Europe", Autres: "🌍 Autres",
};

const COUNTRY_NAMES: Record<string, string> = {
  FR: "France", DE: "Allemagne", IT: "Italie", ES: "Espagne", BE: "Belgique",
  NL: "Pays-Bas", AT: "Autriche", PT: "Portugal", IE: "Irlande", LU: "Luxembourg",
  GB: "Royaume-Uni", US: "États-Unis", CH: "Suisse", "??": "Inconnu",
};

const SOURCE_LABELS: Record<string, string> = {
  shopify: "Shopify", printify: "Printify", prodigi: "Prodigi", artelo: "Artelo",
  qonto: "Qonto", pennylane: "Pennylane", meta: "Meta Ads",
};

/** Montant compact pour les petits labels (pas de décimales). */
function compact(n: number, currency: string): string {
  return money(Math.round(n), currency);
}

// --- Sélecteur de période ----------------------------------------------------

export function PeriodTabs({ value, onChange }: { value: PeriodChoice; onChange: (k: PeriodChoice) => void }) {
  const tabs: { key: PeriodChoice; label: string }[] = [
    { key: "day", label: "Jour" },
    { key: "week", label: "Semaine" },
    { key: "d14", label: "14 jours" },
    { key: "d30", label: "30 jours" },
    { key: "custom", label: "Perso" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel p-1 text-sm">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
            value === t.key ? "bg-accent text-ink" : "text-muted hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Sélecteur de dates pour la période perso (bornes limitées aux 30 jours chargés). */
export function CustomRange({
  from,
  to,
  min,
  max,
  onChange,
}: {
  from: string;
  to: string;
  min: string;
  max: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1 text-muted">
        Du
        <input
          type="date"
          value={from}
          min={min}
          max={to}
          onChange={(e) => onChange(e.target.value, to)}
          className="rounded-md border border-line bg-panel-2 px-2 py-1 text-white [color-scheme:dark]"
        />
      </label>
      <label className="flex items-center gap-1 text-muted">
        au
        <input
          type="date"
          value={to}
          min={from}
          max={max}
          onChange={(e) => onChange(from, e.target.value)}
          className="rounded-md border border-line bg-panel-2 px-2 py-1 text-white [color-scheme:dark]"
        />
      </label>
    </div>
  );
}

// --- Cartes KPI --------------------------------------------------------------

export function KpiRow({ b, currency, usdPerEur }: { b: PnLBucket; currency: string; usdPerEur: number }) {
  const totalCost = b.cogs + b.fulfillment + b.shipping + b.ads + b.fees + b.expenses + b.refunds;
  const margin = b.revenue > 0 ? b.net / b.revenue : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Chiffre d'affaires" value={money(b.revenue, currency)} usdv={usd(b.revenue, usdPerEur)} sub={`${b.orders} commandes`} tone="neutral" />
      <Kpi label="Coûts totaux" value={money(totalCost, currency)} usdv={usd(totalCost, usdPerEur)} sub="prod + port + pub + frais" tone="neutral" />
      <Kpi label="Marge nette" value={money(b.net, currency)} usdv={usd(b.net, usdPerEur)} sub={pct(margin) + " de marge"} tone={b.net >= 0 ? "pos" : "neg"} />
      <Kpi
        label="Verdict"
        value={b.net >= 0 ? "Rentable ✅" : "Déficit ⚠️"}
        sub={b.net >= 0 ? "dans le vert" : "dans le rouge"}
        tone={b.net >= 0 ? "pos" : "neg"}
      />
    </div>
  );
}

function Kpi({ label, value, usdv, sub, tone }: { label: string; value: string; usdv?: string; sub: string; tone: "pos" | "neg" | "neutral" }) {
  const ring = tone === "pos" ? "border-pos/40" : tone === "neg" ? "border-neg/40" : "border-line";
  const val = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-white";
  return (
    <div className={`rounded-xl border ${ring} bg-panel p-4`}>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${val}`}>{value}</div>
      {usdv && <div className="text-xs text-muted">≈ {usdv}</div>}
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  );
}

// --- Graphe journalier (14 derniers jours, agrandi, net dans les barres) -----

const RANGE_TITLE: Record<PeriodKey, string> = {
  day: "Aujourd'hui", week: "7 derniers jours", d14: "14 derniers jours", d30: "30 derniers jours",
};
const RANGE_DAYS: Record<PeriodKey, number> = { day: 1, week: 7, d14: 14, d30: 30 };

export function DailyChart({
  daily,
  currency,
  usdPerEur,
  period,
  range,
  selected,
  onSelect,
}: {
  daily: PnLBucket[];
  currency: string;
  usdPerEur: number;
  period: PeriodChoice;
  range?: { from: string; to: string } | null;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const days =
    period === "custom" && range
      ? daily.filter((d) => d.key >= range.from && d.key <= range.to)
      : daily.slice(-RANGE_DAYS[period === "custom" ? "d30" : period]);
  const n = days.length;
  const max = Math.max(1, ...days.map((d) => Math.max(d.revenue, Math.abs(d.net))));
  const showNet = n <= 14; // au-delà, trop serré : on garde le survol
  const title =
    period === "custom" && range ? `${dayLabel(range.from)} → ${dayLabel(range.to)}` : RANGE_TITLE[period === "custom" ? "d30" : period];
  return (
    <Panel title={title} subtitle="Barre = CA · chiffre = marge nette · clique un jour pour le détail">
      <div className="flex items-end gap-1 h-64">
        {days.map((d) => {
          const revH = (d.revenue / max) * 100;
          const active = d.key === selected;
          return (
            <button
              key={d.key}
              onClick={() => onSelect(d.key)}
              className="group relative flex-1 flex flex-col justify-end items-center h-full min-w-0"
            >
              {showNet && (
                <div className={`mb-1 text-[10px] font-semibold leading-none ${signedClass(d.net)}`}>
                  {d.net >= 0 ? "+" : ""}{compact(d.net, currency)}
                </div>
              )}
              <div
                className={`w-full rounded-t transition-opacity ${
                  d.net >= 0 ? "bg-accent/50" : "bg-neg/50"
                } ${active ? "ring-2 ring-white/70 opacity-100" : "group-hover:opacity-80"}`}
                style={{ height: `${Math.max(revH, 1)}%` }}
              />
              {n <= 14 && (
                <div className="mt-1 text-[9px] text-muted whitespace-nowrap">{dayLabel(d.key).replace(".", "")}</div>
              )}
              <div className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded bg-panel-2 border border-line px-2 py-1 text-[11px] z-10">
                <div className="font-medium">{dayLabel(d.key)}</div>
                <div>CA {money(d.revenue, currency)} <span className="text-muted">≈ {usd(d.revenue, usdPerEur)}</span></div>
                <div className={signedClass(d.net)}>Net {money(d.net, currency)}</div>
                <div className="text-muted">{d.orders} cmd</div>
              </div>
            </button>
          );
        })}
      </div>
      {n > 14 && <p className="mt-2 text-[10px] text-muted">Survole ou clique une barre pour la marge et le détail du jour.</p>}
    </Panel>
  );
}

// --- Détail d'une journée (par région) ---------------------------------------

export function DayDetail({ bucket, currency, usdPerEur }: { bucket: PnLBucket; currency: string; usdPerEur: number }) {
  const regions = bucket.regions ?? [];
  const roas = bucket.roas;
  return (
    <Panel title={`Détail — ${dayLabel(bucket.key)}`} subtitle="KPI, seuil de rentabilité et postes par région pour ce jour">
      {/* KPI du jour (comme la période, mais pour le jour cliqué) */}
      <div className="mb-4">
        <KpiRow b={bucket} currency={currency} usdPerEur={usdPerEur} />
      </div>

      {/* Zone seuil de rentabilité (BE) — ce qu'il faut atteindre ce jour-là */}
      {roas && <DayBreakEven roas={roas} currency={currency} />}

      {/* Postes par région (CA, pub, ROAS, coûts, marge) */}
      {regions.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Aucun mouvement par région ce jour-là.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-1 pr-3">Région</th>
                <th className="py-1 px-2 text-right">CA</th>
                <th className="py-1 px-2 text-right">Pub</th>
                <th className="py-1 px-2 text-right">ROAS</th>
                <th className="py-1 px-2 text-right">Impression</th>
                <th className="py-1 px-2 text-right">Cadres</th>
                <th className="py-1 px-2 text-right">Livraison</th>
                <th className="py-1 px-2 text-right">Taxes</th>
                <th className="py-1 pl-2 text-right">Marge</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => {
                // Marge = CA − coûts réels (hors TVA collectée, qui est une dette).
                const marge = r.revenue - r.print - r.frames - r.shipping - r.fees - r.ads;
                const roas = r.ads > 0 ? r.revenue / r.ads : null;
                return (
                  <tr key={r.region} className="border-t border-line">
                    <td className="py-2 pr-3 font-medium">{REGION_LABELS[r.region] ?? r.region}</td>
                    <td className="py-2 px-2 text-right">{money(r.revenue, currency)}</td>
                    <td className="py-2 px-2 text-right text-neg">{r.ads ? `−${money(r.ads, currency)}` : "—"}</td>
                    <td className={`py-2 px-2 text-right font-medium ${roas && roas >= 2 ? "text-pos" : roas ? "text-warn" : "text-muted"}`}>
                      {roas ? `${roas.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}×` : "—"}
                    </td>
                    <td className="py-2 px-2 text-right text-neg">{r.print ? `−${money(r.print, currency)}` : "—"}</td>
                    <td className="py-2 px-2 text-right text-neg">{r.frames ? `−${money(r.frames, currency)}` : "—"}</td>
                    <td className="py-2 px-2 text-right text-neg">{r.shipping ? `−${money(r.shipping, currency)}` : "—"}</td>
                    <td className="py-2 px-2 text-right align-top">
                      <div className="text-warn">{r.taxes ? money(r.taxes, currency) : "—"}</div>
                      {r.taxes ? (
                        <div className="text-[10px] text-muted leading-tight">
                          TVA {money(r.tva, currency)} · frais {money(r.fees, currency)}
                        </div>
                      ) : null}
                    </td>
                    <td className={`py-2 pl-2 text-right font-semibold ${signedClass(marge)}`}>{money(marge, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(() => {
                const t = regions.reduce(
                  (a, r) => ({
                    revenue: a.revenue + r.revenue,
                    ads: a.ads + r.ads,
                    print: a.print + r.print,
                    frames: a.frames + r.frames,
                    shipping: a.shipping + r.shipping,
                    taxes: a.taxes + r.taxes,
                    fees: a.fees + r.fees,
                  }),
                  { revenue: 0, ads: 0, print: 0, frames: 0, shipping: 0, taxes: 0, fees: 0 }
                );
                const marge = t.revenue - t.print - t.frames - t.shipping - t.fees - t.ads;
                const roas = t.ads > 0 ? t.revenue / t.ads : null;
                return (
                  <tr className="border-t-2 border-line font-semibold">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 px-2 text-right">{money(t.revenue, currency)}</td>
                    <td className="py-2 px-2 text-right text-neg">{t.ads ? `−${money(t.ads, currency)}` : "—"}</td>
                    <td className={`py-2 px-2 text-right ${roas && roas >= 2 ? "text-pos" : "text-warn"}`}>
                      {roas ? `${roas.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}×` : "—"}
                    </td>
                    <td className="py-2 px-2 text-right text-neg">{t.print ? `−${money(t.print, currency)}` : "—"}</td>
                    <td className="py-2 px-2 text-right text-neg">{t.frames ? `−${money(t.frames, currency)}` : "—"}</td>
                    <td className="py-2 px-2 text-right text-neg">{t.shipping ? `−${money(t.shipping, currency)}` : "—"}</td>
                    <td className="py-2 px-2 text-right text-warn">{t.taxes ? money(t.taxes, currency) : "—"}</td>
                    <td className={`py-2 pl-2 text-right ${signedClass(marge)}`}>{money(marge, currency)}</td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      )}

      {/* Détail des frais Shopify (paiement + change + TVA) */}
      {bucket.feeBreakdown && (bucket.feeBreakdown.payments || bucket.feeBreakdown.currency || bucket.feeBreakdown.vat || bucket.feeBreakdown.other) ? (
        <div className="mt-3 rounded-lg bg-panel-2 px-3 py-2 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted">Frais Shopify du jour</div>
          <FeeLine label="Shopify Payments" value={bucket.feeBreakdown.payments} currency={currency} />
          <FeeLine label="Frais de change" value={bucket.feeBreakdown.currency} currency={currency} />
          {bucket.feeBreakdown.vat > 0 && <FeeLine label="TVA sur frais" value={bucket.feeBreakdown.vat} currency={currency} />}
          {bucket.feeBreakdown.other > 0 && <FeeLine label="Autres frais" value={bucket.feeBreakdown.other} currency={currency} />}
          <div className="mt-1 flex justify-between border-t border-line pt-1 font-medium">
            <span>Total frais</span>
            <span className="text-neg">−{money(bucket.feeBreakdown.payments + bucket.feeBreakdown.currency + bucket.feeBreakdown.vat + bucket.feeBreakdown.other, currency)}</span>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-muted">
        ROAS = CA ÷ pub de la région. Marge = CA − impression − cadres − livraison − frais − pub (la TVA collectée n&apos;est pas
        une charge). Pub ventilée par pays via Meta. UK/EU : impression estimée (Prodigi ne facture pas par commande).
      </p>
    </Panel>
  );
}

/** Zone seuil de rentabilité d'un jour, en langage clair. */
function DayBreakEven({ roas, currency }: { roas: RoasStats; currency: string }) {
  const m = roas.marginRate;
  // CA à atteindre pour couvrir pub + charges fixes (le reste étant proportionnel).
  const target = m > 0 ? (roas.adSpend + roas.fixedCosts) / m : null;
  const reached = target !== null && roas.revenue >= target;
  const gap = target !== null ? Math.abs(roas.revenue - target) : 0;
  return (
    <div className="rounded-xl border border-line bg-panel-2 p-3">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted">Seuil de rentabilité du jour</div>
      {target === null ? (
        <p className="text-sm text-neg">Marge produit négative : impossible d&apos;être rentable en l&apos;état.</p>
      ) : (
        <>
          <p className="text-sm">
            Pour être rentable (couvrir la pub <strong>{money(roas.adSpend, currency)}</strong> + les charges fixes
            <strong> {money(roas.fixedCosts, currency)}</strong>), il faut faire{" "}
            <strong className="text-white">{money(target, currency)}</strong> de CA.
          </p>
          <p className={`mt-1 text-sm font-semibold ${reached ? "text-pos" : "text-warn"}`}>
            {reached ? (
              <>Tu es à {money(roas.revenue, currency)} → rentable ✅ (+{money(gap, currency)})</>
            ) : (
              <>Tu es à {money(roas.revenue, currency)} → il manque {money(gap, currency)} de CA</>
            )}
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Avec une marge produit de {pct(m)}, chaque euro de CA dégage {money(m, currency)} pour payer pub et frais fixes.
          </p>
        </>
      )}
    </div>
  );
}

function FeeLine({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className={value ? "text-neg" : ""}>{value ? `−${money(value, currency)}` : "—"}</span>
    </div>
  );
}

// --- Répartition par source (sur la période choisie) -------------------------

export function SourceBreakdown({
  bySource,
  sources,
  currency,
  periodLabel,
}: {
  bySource: BySource;
  sources: SourceStatus[];
  currency: string;
  periodLabel: string;
}) {
  const rows = sources
    .map((s) => ({ id: s.id, label: SOURCE_LABELS[s.id] || s.label, state: s.state, agg: bySource[s.id] }))
    .filter((r) => r.agg && (r.agg.revenue > 0 || r.agg.cost > 0));
  return (
    <Panel title="Par source" subtitle={`Contribution de chaque outil · ${periodLabel.toLowerCase()}`}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Aucun mouvement sur cette période.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <StateDot state={r.state} />
                <span className="font-medium">{r.label}</span>
              </div>
              <div className="flex items-center gap-4 text-right">
                {r.agg.revenue > 0 && <span className="text-muted">CA {money(r.agg.revenue, currency)}</span>}
                {r.agg.cost > 0 && <span className="text-neg">−{money(r.agg.cost, currency)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// --- Projection fiscale ------------------------------------------------------

export function TaxPanel({ tax, currency, periodLabel }: { tax: TaxProjection; currency: string; periodLabel: string }) {
  return (
    <Panel title="TVA & impôts" subtitle={`Projection ${periodLabel.toLowerCase()} — indicatif, à valider avec la compta`}>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">TVA collectée à reverser</div>
          <div className="mt-1 text-xl font-semibold text-warn">{money(tax.vatTotal, currency)}</div>
        </div>
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">IS estimé ({pct(tax.corporateTaxRate)})</div>
          <div className="mt-1 text-xl font-semibold text-warn">{money(tax.corporateTaxEstimate, currency)}</div>
        </div>
      </div>
      {tax.vatByCountry.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted">TVA par pays</div>
          <div className="space-y-1">
            {tax.vatByCountry.slice(0, 8).map((v) => (
              <div key={v.country} className="flex justify-between text-sm">
                <span>{COUNTRY_NAMES[v.country] ?? v.country}</span>
                <span className="text-muted">{money(v.collected, currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

// --- Rapprochement (Pennylane / Qonto) ---------------------------------------

export function ReconciliationPanel({ r, currency }: { r: Reconciliation; currency: string }) {
  const coherent = Math.abs(r.gap) <= Math.max(50, r.operationalCosts * 0.1);
  const bankNet = r.bankInflows - r.bankOutflows;
  return (
    <Panel title="Rapprochement bancaire (30 jours)" subtitle="Tout ce qui passe réellement par Qonto — vérification (encaissements décalés inclus)">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Entrées Qonto</div>
          <div className="mt-1 text-lg font-semibold text-pos">{r.bankInflows > 0 ? money(r.bankInflows, currency) : "—"}</div>
        </div>
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Sorties Qonto</div>
          <div className="mt-1 text-lg font-semibold text-neg">{r.bankOutflows > 0 ? `−${money(r.bankOutflows, currency)}` : "—"}</div>
        </div>
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Mouvement net</div>
          <div className={`mt-1 text-lg font-semibold ${bankNet >= 0 ? "text-pos" : "text-neg"}`}>
            {r.bankInflows || r.bankOutflows ? money(bankNet, currency) : "—"}
          </div>
        </div>
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Charges Pennylane</div>
          <div className="mt-1 text-lg font-semibold">{r.accountingExpenses > 0 ? money(r.accountingExpenses, currency) : "—"}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted">
        <span>Coûts opérationnels comptés dans la marge : <strong className="text-white">{money(r.operationalCosts, currency)}</strong></span>
        {r.accountingExpenses > 0 && (
          <span className={coherent ? "text-pos" : "text-warn"}>
            Écart ↔ compta : <strong>{money(r.gap, currency)}</strong> {coherent ? "✅" : "à investiguer"}
          </span>
        )}
      </div>
    </Panel>
  );
}

// --- ROAS & seuil de rentabilité ---------------------------------------------

/** Formate un ROAS (multiplicateur) : 2.53 -> "2,53×". */
function roasFmt(v: number | null): string {
  if (v === null) return "—";
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

export function RoasPanel({ roas, currency, periodLabel }: { roas: RoasStats; currency: string; periodLabel: string }) {
  const profitable = roas.actual !== null && roas.breakEven !== null && roas.actual >= roas.breakEven;
  const verdict =
    roas.actual === null
      ? { tone: "text-muted", txt: "Pas de dépense pub sur la période (branche Meta pour le ROAS constaté)." }
      : roas.breakEven === null
      ? { tone: "text-neg", txt: "Marge produit négative : la pub ne peut pas être rentable en l'état." }
      : profitable
      ? { tone: "text-pos", txt: "ROAS au-dessus du seuil produit ✅ — la pub est rentable." }
      : { tone: "text-neg", txt: "ROAS sous le seuil produit ⚠️ — la pub perd de l'argent." };
  // Le ROAS constaté est-il au-dessus de chaque seuil ?
  const okVs = (be: number | null) => roas.actual !== null && be !== null && roas.actual >= be;
  return (
    <Panel title="ROAS & seuils de rentabilité" subtitle={`Break-even à 3 niveaux vs constaté · ${periodLabel.toLowerCase()}`}>
      {/* ROAS constaté (blended) en avant */}
      <div className={`rounded-xl border p-4 ${profitable ? "border-pos/40" : "border-neg/40"} bg-panel-2`}>
        <div className="text-xs uppercase tracking-wide text-muted">ROAS constaté (blended)</div>
        <div className={`mt-1 text-3xl font-semibold ${profitable ? "text-pos" : "text-neg"}`}>{roasFmt(roas.actual)}</div>
        <div className="mt-1 text-xs text-muted">CA total ÷ dépense pub</div>
      </div>

      {/* Les 2 seuils d'équilibre demandés */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <BeTile label="BE produit + pub" hint="prod + livraison + frais + change" value={roas.breakEven} ok={okVs(roas.breakEven)} hasActual={roas.actual !== null} primary />
        <BeTile label="BE tout compris" hint="+ charges fixes (salaires, Urssaf…)" value={roas.breakEvenAllIn} ok={okVs(roas.breakEvenAllIn)} hasActual={roas.actual !== null} />
      </div>

      <div className={`mt-3 text-sm ${verdict.tone}`}>{verdict.txt}</div>

      <div className="mt-3 space-y-1 rounded-lg bg-panel-2 px-3 py-2 text-sm text-muted">
        <div className="flex justify-between"><span>CA (base marge)</span><span className="text-white">{money(roas.revenue, currency)}</span></div>
        <div className="flex justify-between"><span>Coûts variables (prod + livraison + frais + change)</span><span className="text-neg">−{money(roas.variableCosts, currency)}</span></div>
        <div className="flex justify-between"><span>Charges fixes (réparties)</span><span className="text-neg">{roas.fixedCosts ? `−${money(roas.fixedCosts, currency)}` : "—"}</span></div>
        <div className="flex justify-between border-t border-line pt-1">
          <span>Marge de contribution avant pub</span>
          <span className={signedClass(roas.contributionMargin)}>{money(roas.contributionMargin, currency)} <span className="text-xs">({pct(roas.marginRate)})</span></span>
        </div>
        <div className="flex justify-between"><span>Dépense pub</span><span className="text-neg">{roas.adSpend ? `−${money(roas.adSpend, currency)}` : "—"}</span></div>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        <strong>BE produit + pub</strong> = seuil à battre pour que la pub soit rentable (tous coûts variables).
        <strong> BE tout compris</strong> = + charges fixes (salaires, Urssaf, abonnements, estimés depuis Qonto).
        ROAS constaté = « blended » (toutes ventes ÷ pub), faute d&apos;attribution par campagne.
      </p>
    </Panel>
  );
}

function BeTile({ label, hint, value, ok, hasActual, primary }: { label: string; hint: string; value: number | null; ok: boolean; hasActual: boolean; primary?: boolean }) {
  const tone = !hasActual ? "text-warn" : ok ? "text-pos" : "text-neg";
  return (
    <div className={`rounded-lg p-3 ${primary ? "bg-panel-2 ring-1 ring-line" : "bg-panel-2"}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone}`}>{roasFmt(value)}</div>
      <div className="mt-0.5 text-[10px] text-muted">{hint}</div>
    </div>
  );
}

// --- Frais de conversion de devise ($/£ -> €) par mois -----------------------

export function ConversionFeePanel({
  slice,
  monthly,
  currency,
  periodLabel,
}: {
  slice: ConversionFeeSlice;
  monthly: ConversionFeeReport;
  currency: string;
  periodLabel: string;
}) {
  const periodRows = monthly.sources
    .map((id) => ({ id, line: slice.bySource[id] }))
    .filter((r) => r.line && r.line.fee > 0);
  const arteloPeriod = slice.bySource.artelo?.fee ?? 0;
  const monthsWithData = monthly.months.filter((m) => m.total > 0);
  return (
    <Panel
      title="Frais de conversion $ → €"
      subtitle={`Taux banque estimé à ${pct(slice.feeRate)} sur les factures en USD · ${periodLabel.toLowerCase()}`}
    >
      {/* Total de la période sélectionnée (suit le filtre Jour/Semaine/…/Perso) */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Frais Artelo · {periodLabel.toLowerCase()}</div>
          <div className="mt-1 text-xl font-semibold text-neg">{arteloPeriod ? `−${money(arteloPeriod, currency)}` : "—"}</div>
        </div>
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Total frais de change · {periodLabel.toLowerCase()}</div>
          <div className="mt-1 text-xl font-semibold text-neg">{slice.total ? `−${money(slice.total, currency)}` : "—"}</div>
        </div>
      </div>

      {periodRows.length === 0 ? (
        <p className="text-sm text-muted">Aucune facture en USD sur cette période.</p>
      ) : (
        <div className="space-y-1">
          {periodRows.map((r) => (
            <div key={r.id} className="flex justify-between text-sm text-muted">
              <span>
                {SOURCE_LABELS[r.id] ?? r.id}
                <span className="ml-1 text-xs">({compact(r.line!.spendBase, currency)} en {r.line!.currency})</span>
              </span>
              <span className="text-neg">−{money(r.line!.fee, currency)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Historique par mois (indépendant du filtre) */}
      {monthsWithData.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-muted">Historique par mois</div>
          <div className="space-y-2">
            {monthsWithData.map((m) => (
              <div key={m.month} className="flex items-center justify-between text-sm">
                <span>{m.label}</span>
                <span className="font-medium text-neg">−{money(m.total, currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ul className="mt-3 space-y-0.5 text-[11px] text-muted">
        {monthly.notes.map((n, i) => (
          <li key={i}>• {n}</li>
        ))}
      </ul>
    </Panel>
  );
}

// --- État des connecteurs ----------------------------------------------------

export function SourceStatusPanel({ sources }: { sources: SourceStatus[] }) {
  return (
    <Panel title="Connecteurs" subtitle="Branche une clé API dans Vercel pour passer en direct">
      <div className="space-y-2">
        {sources.map((s) => (
          <div key={s.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <StateDot state={s.state} />
              <span className="font-medium">{SOURCE_LABELS[s.id] || s.label}</span>
            </div>
            <span className="text-xs text-muted text-right max-w-[60%] truncate">{s.detail}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function StateDot({ state }: { state: SourceStatus["state"] }) {
  const color =
    state === "live" ? "bg-pos" : state === "demo" ? "bg-accent" : state === "error" ? "bg-neg" : "bg-muted/50";
  const title = state === "live" ? "En direct" : state === "demo" ? "Démo" : state === "error" ? "Erreur" : "Non branché";
  return <span title={title} className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

// --- Conteneur ---------------------------------------------------------------

export function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
