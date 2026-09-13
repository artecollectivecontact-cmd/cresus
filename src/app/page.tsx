import { buildReport } from "@/lib/pnl";
import { dayLabel } from "@/lib/format";
import { authEnabled } from "@/lib/auth";
import {
  KpiRow,
  HourlyChart,
  DailyChart,
  SourceBreakdown,
  TaxPanel,
  ReconciliationPanel,
  SourceStatusPanel,
} from "@/components/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export default async function Home({
  searchParams,
}: {
  searchParams: { focusDay?: string };
}) {
  const report = await buildReport({ days: 14, focusDay: searchParams.focusDay });

  const focusBucket =
    report.daily.find((d) => d.key === report.focusDay) ??
    report.daily[report.daily.length - 1] ??
    report.total;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6" style={{ paddingInline: "max(16px, env(safe-area-inset-left))" }}>
      {/* En-tête */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Crésus <span className="text-muted font-normal">· Arte Collective</span>
          </h1>
          <p className="text-sm text-muted">
            Rentabilité jour par jour et heure par heure — tout l&apos;argent qui rentre et qui sort, centralisé.
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <div>Devise : {report.currency}</div>
          <div>MàJ {new Date(report.generatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</div>
          {authEnabled() && (
            <a href="/api/login" className="mt-1 inline-block text-accent hover:underline">
              Déconnexion
            </a>
          )}
        </div>
      </header>

      {report.demo && (
        <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm">
          <strong>Mode démo</strong> — aucune clé API branchée. Les chiffres s&apos;appuient sur les vraies commandes
          Shopify du jour + un historique de démonstration et des coûts POD estimés. Branche les clés dans Vercel
          (voir <code className="text-accent">.env.example</code>) pour passer en direct.
        </div>
      )}

      {/* Jour ciblé + KPI */}
      <div className="mb-2 text-sm text-muted">
        Journée analysée : <span className="text-white font-medium">{dayLabel(report.focusDay)}</span>
      </div>
      <div className="mb-5">
        <KpiRow b={focusBucket} currency={report.currency} />
      </div>

      {/* Graphes */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <HourlyChart hourly={report.hourly} currency={report.currency} />
        <DailyChart daily={report.daily} currency={report.currency} focusDay={report.focusDay} />
      </div>

      {/* Détails */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SourceBreakdown report={report} />
        <TaxPanel report={report} />
      </div>

      <div className="mt-4">
        <ReconciliationPanel report={report} />
      </div>

      <div className="mt-4">
        <SourceStatusPanel sources={report.sources} />
      </div>

      <footer className="mt-8 text-center text-xs text-muted">
        Crésus — hébergé sur Vercel · les projections fiscales sont indicatives, à valider avec Pennylane / la compta.
      </footer>
    </main>
  );
}
