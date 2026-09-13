import type { PnLBucket, BySource, SourceStatus, TaxProjection, Reconciliation, PeriodKey } from "@/lib/types";
import { money, pct, dayLabel, signedClass } from "@/lib/format";

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

export function PeriodTabs({ value, onChange }: { value: PeriodKey; onChange: (k: PeriodKey) => void }) {
  const tabs: { key: PeriodKey; label: string }[] = [
    { key: "day", label: "Jour" },
    { key: "week", label: "Semaine" },
    { key: "d14", label: "14 jours" },
    { key: "d30", label: "30 jours" },
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

// --- Cartes KPI --------------------------------------------------------------

export function KpiRow({ b, currency }: { b: PnLBucket; currency: string }) {
  const totalCost = b.cogs + b.fulfillment + b.shipping + b.ads + b.fees + b.expenses + b.refunds;
  const margin = b.revenue > 0 ? b.net / b.revenue : 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Chiffre d'affaires" value={money(b.revenue, currency)} sub={`${b.orders} commandes`} tone="neutral" />
      <Kpi label="Coûts totaux" value={money(totalCost, currency)} sub="prod + port + pub + frais" tone="neutral" />
      <Kpi label="Marge nette" value={money(b.net, currency)} sub={pct(margin) + " de marge"} tone={b.net >= 0 ? "pos" : "neg"} />
      <Kpi
        label="Verdict"
        value={b.net >= 0 ? "Rentable ✅" : "Déficit ⚠️"}
        sub={b.net >= 0 ? "dans le vert" : "dans le rouge"}
        tone={b.net >= 0 ? "pos" : "neg"}
      />
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "pos" | "neg" | "neutral" }) {
  const ring = tone === "pos" ? "border-pos/40" : tone === "neg" ? "border-neg/40" : "border-line";
  const val = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-white";
  return (
    <div className={`rounded-xl border ${ring} bg-panel p-4`}>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${val}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  );
}

// --- Graphe journalier (14 derniers jours, agrandi, net dans les barres) -----

export function DailyChart({ daily, currency }: { daily: PnLBucket[]; currency: string }) {
  const days = daily.slice(-14);
  const max = Math.max(1, ...days.map((d) => Math.max(d.revenue, Math.abs(d.net))));
  return (
    <Panel title="14 derniers jours" subtitle="Barre = chiffre d'affaires · chiffre = marge nette du jour">
      <div className="flex items-end gap-1.5 h-64">
        {days.map((d) => {
          const revH = (d.revenue / max) * 100;
          return (
            <div key={d.key} className="group relative flex-1 flex flex-col justify-end items-center h-full">
              {/* net en petit au-dessus de la barre */}
              <div className={`mb-1 text-[10px] font-semibold leading-none ${signedClass(d.net)}`}>
                {d.net >= 0 ? "+" : ""}{compact(d.net, currency)}
              </div>
              <div
                className={`w-full rounded-t ${d.net >= 0 ? "bg-accent/50" : "bg-neg/50"} group-hover:opacity-80`}
                style={{ height: `${Math.max(revH, 1)}%` }}
              />
              <div className="mt-1 text-[9px] text-muted whitespace-nowrap">{dayLabel(d.key).replace(".", "")}</div>
              <div className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded bg-panel-2 border border-line px-2 py-1 text-[11px] z-10">
                <div className="font-medium">{dayLabel(d.key)}</div>
                <div>CA {money(d.revenue, currency)}</div>
                <div className={signedClass(d.net)}>Net {money(d.net, currency)}</div>
                <div className="text-muted">{d.orders} cmd</div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
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
  return (
    <Panel title="Rapprochement (30 jours)" subtitle="Recoupe la marge opérationnelle avec la compta et la banque">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Coûts opérationnels</div>
          <div className="mt-1 text-lg font-semibold">{money(r.operationalCosts, currency)}</div>
        </div>
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Charges Pennylane</div>
          <div className="mt-1 text-lg font-semibold">{r.accountingExpenses > 0 ? money(r.accountingExpenses, currency) : "—"}</div>
        </div>
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">Sorties Qonto</div>
          <div className="mt-1 text-lg font-semibold">{r.bankOutflows > 0 ? money(r.bankOutflows, currency) : "—"}</div>
        </div>
      </div>
      {r.accountingExpenses > 0 && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${coherent ? "bg-pos/10 text-pos" : "bg-warn/10 text-warn"}`}>
          Écart marge ↔ compta : <strong>{money(r.gap, currency)}</strong>{" "}
          {coherent ? "· cohérent ✅" : "· à investiguer"}
        </div>
      )}
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
