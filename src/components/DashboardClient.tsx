"use client";

import { useEffect, useRef, useState } from "react";
import type { PeriodKey, PnLReport } from "@/lib/types";
import { LoadingScreen } from "./LoadingScreen";
import {
  PeriodTabs,
  KpiRow,
  DailyChart,
  DayDetail,
  SourceBreakdown,
  TaxPanel,
  ReconciliationPanel,
  ConversionFeePanel,
  SourceStatusPanel,
} from "./dashboard";

export function DashboardClient({ authEnabled }: { authEnabled: boolean }) {
  const [report, setReport] = useState<PnLReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("day");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Animation de progression pendant le fetch (avance vers ~0.9).
    const timer = setInterval(() => {
      setProgress((p) => (p < 0.9 ? p + 0.9 * 0.04 : p));
    }, 200);

    fetch("/api/pnl", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/login?from=%2F";
          return;
        }
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        clearInterval(timer);
        setReport(data as PnLReport);
        setProgress(1);
        // On laisse voir les barres se compléter un court instant.
        setTimeout(() => setLoading(false), 650);
      })
      .catch((e) => {
        clearInterval(timer);
        setError(e.message || "Erreur de chargement");
      });

    return () => clearInterval(timer);
  }, []);

  if (error && !report) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-neg/40 bg-panel p-6 text-center">
          <div className="mb-2 text-lg font-semibold">Oups</div>
          <p className="mb-4 text-sm text-muted">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink"
          >
            Réessayer
          </button>
        </div>
      </main>
    );
  }

  if (loading || !report) {
    return <LoadingScreen progress={progress} finalSources={report?.sources} error={error} />;
  }

  const slice = report.periods[period];
  const detailKey = selectedDay ?? report.daily[report.daily.length - 1]?.key ?? null;
  const detailBucket = report.daily.find((d) => d.key === detailKey) ?? null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6" style={{ paddingInline: "max(16px, env(safe-area-inset-left))" }}>
      {/* En-tête */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Crésus <span className="text-muted font-normal">· Arte Collective</span>
          </h1>
          <p className="text-sm text-muted">
            Combien on gagne, combien on paye — chaque jour, en direct.
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <div>Devise : {report.currency}</div>
          <div>MàJ {new Date(report.generatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</div>
          {authEnabled && (
            <a href="/api/login" className="mt-1 inline-block text-accent hover:underline">
              Déconnexion
            </a>
          )}
        </div>
      </header>

      {report.demo && (
        <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm">
          <strong>Mode démo</strong> — aucune clé API branchée. Chiffres de démonstration.
        </div>
      )}

      {/* Sélecteur de période */}
      <div className="mb-4 flex items-center gap-3">
        <PeriodTabs value={period} onChange={setPeriod} />
        <span className="text-sm text-muted">{slice.label}</span>
      </div>

      {/* KPI de la période */}
      <div className="mb-5">
        <KpiRow b={slice.bucket} currency={report.currency} usdPerEur={report.usdPerEur} />
      </div>

      {/* Graphe (suit la période) — pleine largeur, cliquable */}
      <div className="mb-4">
        <DailyChart
          daily={report.daily}
          currency={report.currency}
          usdPerEur={report.usdPerEur}
          period={period}
          selected={detailKey}
          onSelect={setSelectedDay}
        />
      </div>

      {/* Détail du jour sélectionné (par région) */}
      {detailBucket && (
        <div className="mb-4">
          <DayDetail bucket={detailBucket} currency={report.currency} usdPerEur={report.usdPerEur} />
        </div>
      )}

      {/* Par source (période) + TVA en dessous */}
      <div className="mb-4">
        <SourceBreakdown
          bySource={slice.bySource}
          sources={report.sources}
          currency={report.currency}
          periodLabel={slice.label}
        />
      </div>

      <div className="mb-4">
        <TaxPanel tax={slice.tax} currency={report.currency} periodLabel={slice.label} />
      </div>

      <div className="mb-4">
        <ReconciliationPanel r={report.reconciliation} currency={report.currency} />
      </div>

      <div className="mb-4">
        <ConversionFeePanel cf={report.conversionFees} currency={report.currency} />
      </div>

      <div className="mb-4">
        <SourceStatusPanel sources={report.sources} />
      </div>

      <footer className="mt-8 text-center text-xs text-muted">
        Crésus — hébergé sur Vercel · projections fiscales indicatives, à valider avec la compta.
      </footer>
    </main>
  );
}
