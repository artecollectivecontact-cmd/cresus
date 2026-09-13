"use client";

import type { SourceStatus } from "@/lib/types";

const SOURCES: { id: string; label: string }[] = [
  { id: "shopify", label: "Shopify" },
  { id: "printify", label: "Printify" },
  { id: "prodigi", label: "Prodigi" },
  { id: "artelo", label: "Artelo" },
  { id: "qonto", label: "Qonto" },
  { id: "pennylane", label: "Pennylane" },
  { id: "meta", label: "Meta Ads" },
];

export function LoadingScreen({
  progress,
  finalSources,
  error,
}: {
  progress: number; // 0..1
  finalSources?: SourceStatus[];
  error?: string | null;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-1 text-2xl font-bold tracking-tight">
          Crésus <span className="text-muted font-normal">· Arte Collective</span>
        </div>
        <p className="mb-6 text-sm text-muted">
          {error ? "Une source a rencontré un souci — on continue quand même." : "Récupération de tes données en cours…"}
        </p>

        <div className="space-y-3">
          {SOURCES.map((s, i) => {
            const final = finalSources?.find((f) => f.id === s.id);
            // Remplissage échelonné par source tant qu'on n'a pas la réponse.
            const staggered = Math.max(0, Math.min(1, (progress - i * 0.06) / 0.55));
            const width = final ? 100 : Math.round(staggered * 100);
            const color = final
              ? final.state === "live"
                ? "bg-pos"
                : final.state === "demo"
                ? "bg-accent"
                : final.state === "error"
                ? "bg-neg"
                : "bg-muted/50"
              : "bg-accent";
            const status = final
              ? final.state === "live"
                ? final.detail
                : final.state === "demo"
                ? "démo"
                : final.state === "error"
                ? "erreur"
                : "non branché"
              : width >= 100
              ? "…"
              : "chargement…";
            return (
              <div key={s.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted">{status}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
                  <div
                    className={`h-full rounded-full ${color} transition-all duration-300 ease-out`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-panel-2">
          <div
            className="h-full rounded-full bg-white/70 transition-all duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
    </main>
  );
}
