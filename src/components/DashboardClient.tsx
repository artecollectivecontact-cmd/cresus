"use client";

import { useEffect, useRef, useState } from "react";
import type { PnLReport, PeriodSlice } from "@/lib/types";
import { LoadingScreen } from "./LoadingScreen";
import {
  PeriodTabs,
  CustomRange,
  KpiRow,
  DailyChart,
  DayDetail,
  SourceBreakdown,
  TaxPanel,
  ReconciliationPanel,
  ConversionFeePanel,
  RoasPanel,
  SourceStatusPanel,
  type PeriodChoice,
} from "./dashboard";

export function DashboardClient({ authEnabled }: { authEnabled: boolean }) {
  const [report, setReport] = useState<PnLReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodChoice>("day");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const started = useRef(false);

  // Période perso (dates bornées aux 30 jours chargés).
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customSlice, setCustomSlice] = useState<PeriodSlice | null>(null);
  const [customLoading, setCustomLoading] = useState(false);

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
        setTimeout(() => setLoading(false), 650);
      })
      .catch((e) => {
        clearInterval(timer);
        setError(e.message || "Erreur de chargement");
      });

    return () => clearInterval(timer);
  }, []);

  // Valeurs par défaut de la période perso dès que les données sont là (7 j).
  useEffect(() => {
    if (!report || customTo) return;
    const keys = report.daily.map((d) => d.key);
    if (keys.length === 0) return;
    setCustomTo(keys[keys.length - 1]);
    setCustomFrom(keys[Math.max(0, keys.length - 7)]);
  }, [report, customTo]);

  // Calcul de la période perso côté serveur (données déjà en cache -> rapide).
  useEffect(() => {
    if (period !== "custom" || !customFrom || !customTo) return;
    let cancelled = false;
    setCustomLoading(true);
    fetch(`/api/pnl?from=${customFrom}&to=${customTo}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!cancelled) setCustomSlice(data.slice as PeriodSlice);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Erreur période perso");
      })
      .finally(() => {
        if (!cancelled) setCustomLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, customFrom, customTo]);

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

  const isCustom = period === "custom";
  const slice: PeriodSlice | null = isCustom ? customSlice : report.periods[period];
  const range = isCustom && customFrom && customTo ? { from: customFrom, to: customTo } : null;

  // Jour de détail : borné à la fenêtre affichée.
  const windowDays = range
    ? report.daily.filter((d) => d.key >= range.from && d.key <= range.to)
    : report.daily;
  const detailKey = selectedDay ?? windowDays[windowDays.length - 1]?.key ?? null;
  const detailBucket = report.daily.find((d) => d.key === detailKey) ?? null;

  const minDay = report.daily[0]?.key ?? "";
  const maxDay = report.daily[report.daily.length - 1]?.key ?? "";

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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodTabs value={period} onChange={setPeriod} />
        {isCustom ? (
          <CustomRange
            from={customFrom}
            to={customTo}
            min={minDay}
            max={maxDay}
            onChange={(f, t) => {
              setCustomFrom(f);
              setCustomTo(t);
              setSelectedDay(null);
            }}
          />
        ) : (
          <span className="text-sm text-muted">{report.periods[period].label}</span>
        )}
      </div>

      {slice ? (
        <>
          {/* KPI de la période */}
          <div className="mb-5">
            <KpiRow b={slice.bucket} currency={report.currency} usdPerEur={report.usdPerEur} />
          </div>
        </>
      ) : (
        <div className="mb-5 rounded-xl border border-line bg-panel p-6 text-center text-sm text-muted">
          {customLoading ? "Calcul de la période…" : "Choisis deux dates."}
        </div>
      )}

      {/* Graphe (suit la période) — pleine largeur, cliquable */}
      <div className="mb-4">
        <DailyChart
          daily={report.daily}
          currency={report.currency}
          usdPerEur={report.usdPerEur}
          period={period}
          range={range}
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

      {slice && (
        <>
          {/* ROAS & seuil de rentabilité (suit la période) */}
          <div className="mb-4">
            <RoasPanel roas={slice.roas} currency={report.currency} periodLabel={slice.label} />
          </div>

          {/* Par source (période) */}
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
            <ConversionFeePanel
              slice={slice.conversionFee}
              monthly={report.conversionFees}
              currency={report.currency}
              periodLabel={slice.label}
            />
          </div>
        </>
      )}

      <div className="mb-4">
        <ReconciliationPanel r={report.reconciliation} currency={report.currency} />
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
