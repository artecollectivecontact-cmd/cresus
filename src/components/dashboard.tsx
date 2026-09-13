import Link from "next/link";
import type { PnLBucket, PnLReport, SourceStatus } from "@/lib/types";
import { money, pct, dayLabel, signedClass } from "@/lib/format";

const COUNTRY_NAMES: Record<string, string> = {
  FR: "France", DE: "Allemagne", IT: "Italie", ES: "Espagne", BE: "Belgique",
  NL: "Pays-Bas", AT: "Autriche", PT: "Portugal", IE: "Irlande", LU: "Luxembourg",
  GB: "Royaume-Uni", US: "États-Unis", CH: "Suisse", "??": "Inconnu",
};

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
        sub={b.net >= 0 ? "la journée est dans le vert" : "journée dans le rouge"}
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

// --- Graphe horaire ----------------------------------------------------------

export function HourlyChart({ hourly, currency }: { hourly: PnLBucket[]; currency: string }) {
  const max = Math.max(1, ...hourly.map((h) => Math.max(h.revenue, Math.abs(h.net))));
  return (
    <Panel title="Rentabilité heure par heure" subtitle="CA (barre) et marge nette (point) — fuseau Europe/Paris">
      <div className="flex items-end gap-[3px] h-44">
        {hourly.map((h) => {
          const hour = Number(h.key.slice(-2));
          const revH = (h.revenue / max) * 100;
          const netH = (Math.abs(h.net) / max) * 100;
          return (
            <div key={h.key} className="group relative flex-1 flex flex-col justify-end items-center h-full">
              <div className="w-full rounded-t bg-accent/30 group-hover:bg-accent/50 transition-colors" style={{ height: `${revH}%` }} />
              {h.net !== 0 && (
                <div
                  className={`absolute w-full ${h.net >= 0 ? "bg-pos" : "bg-neg"}`}
                  style={{ height: "2px", bottom: `${netH}%` }}
                />
              )}
              <div className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded bg-panel-2 border border-line px-2 py-1 text-[11px] z-10">
                <div className="font-medium">{String(hour).padStart(2, "0")}h</div>
                <div>CA {money(h.revenue, currency)}</div>
                <div className={signedClass(h.net)}>Net {money(h.net, currency)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>
    </Panel>
  );
}

// --- Graphe journalier -------------------------------------------------------

export function DailyChart({ daily, currency, focusDay }: { daily: PnLBucket[]; currency: string; focusDay: string }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.revenue, Math.abs(d.net))));
  return (
    <Panel title="14 derniers jours" subtitle="Clique un jour pour la vue heure par heure">
      <div className="flex items-end gap-1 h-44">
        {daily.map((d) => {
          const revH = (d.revenue / max) * 100;
          const netH = (d.net / max) * 100;
          const active = d.key === focusDay;
          return (
            <Link
              key={d.key}
              href={`/?focusDay=${d.key}`}
              className="group relative flex-1 flex flex-col justify-end items-center h-full"
            >
              <div className={`w-full rounded-t ${active ? "bg-accent/70" : "bg-accent/25"} group-hover:bg-accent/50`} style={{ height: `${revH}%` }} />
              <div
                className={`absolute left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full ${d.net >= 0 ? "bg-pos" : "bg-neg"}`}
                style={{ bottom: `${Math.max(0, netH)}%` }}
              />
              <div className="pointer-events-none absolute bottom-full mb-1 hidden group-hover:block whitespace-nowrap rounded bg-panel-2 border border-line px-2 py-1 text-[11px] z-10">
                <div className="font-medium">{dayLabel(d.key)}</div>
                <div>CA {money(d.revenue, currency)}</div>
                <div className={signedClass(d.net)}>Net {money(d.net, currency)}</div>
                <div className="text-muted">{d.orders} cmd</div>
              </div>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

// --- Répartition par source --------------------------------------------------

export function SourceBreakdown({ report }: { report: PnLReport }) {
  const rows = report.sources.map((s) => ({ ...s, agg: report.bySource[s.id] }));
  return (
    <Panel title="Par source" subtitle="Contribution de chaque outil à la marge">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <StateDot state={r.state} />
              <span className="font-medium">{r.label}</span>
            </div>
            <div className="flex items-center gap-4 text-right">
              {r.agg.revenue > 0 && <span className="text-muted">CA {money(r.agg.revenue, report.currency)}</span>}
              {r.agg.cost > 0 && <span className="text-neg">−{money(r.agg.cost, report.currency)}</span>}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// --- Projection fiscale ------------------------------------------------------

export function TaxPanel({ report }: { report: PnLReport }) {
  const { tax } = report;
  return (
    <Panel title="TVA & impôts (projection période)" subtitle="Indicatif — à valider avec la compta">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">TVA collectée à reverser</div>
          <div className="mt-1 text-xl font-semibold text-warn">{money(tax.vatTotal, report.currency)}</div>
        </div>
        <div className="rounded-lg bg-panel-2 p-3">
          <div className="text-xs text-muted">IS estimé ({pct(tax.corporateTaxRate)})</div>
          <div className="mt-1 text-xl font-semibold text-warn">{money(tax.corporateTaxEstimate, report.currency)}</div>
        </div>
      </div>
      {tax.vatByCountry.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted">TVA par pays</div>
          <div className="space-y-1">
            {tax.vatByCountry.map((v) => (
              <div key={v.country} className="flex justify-between text-sm">
                <span>{COUNTRY_NAMES[v.country] ?? v.country}</span>
                <span className="text-muted">{money(v.collected, report.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <ul className="mt-3 space-y-1 text-[11px] text-muted list-disc pl-4">
        {tax.notes.map((n, i) => (
          <li key={i}>{n}</li>
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
              <span className="font-medium">{s.label}</span>
            </div>
            <span className="text-xs text-muted text-right max-w-[60%]">{s.detail}</span>
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
