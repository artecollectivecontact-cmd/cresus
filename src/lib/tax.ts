import type { NormalizedEntry, TaxProjection } from "./types";
import { BASE_CURRENCY, CORPORATE_TAX_RATE } from "./config";

// ---------------------------------------------------------------------------
// Projection fiscale simple sur la période analysée.
//
// - TVA : régime OSS de l'UE => on doit reverser la TVA collectée, ventilée par
//   pays de destination. On agrège `tax_collected` par pays.
// - IS : estimation = résultat net (marge) * taux IS. Indicatif — la vraie
//   liasse dépend de la clôture annuelle, des reports, etc.
// ---------------------------------------------------------------------------

export function projectTax(entries: NormalizedEntry[], net: number): TaxProjection {
  const byCountry = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== "tax_collected") continue;
    const c = e.country || "??";
    byCountry.set(c, (byCountry.get(c) ?? 0) + e.amountBase);
  }

  const vatByCountry = [...byCountry.entries()]
    .map(([country, collected]) => ({ country, collected: round2(collected) }))
    .sort((a, b) => b.collected - a.collected);

  const vatTotal = round2(vatByCountry.reduce((s, v) => s + v.collected, 0));
  const corporateTaxEstimate = round2(Math.max(0, net) * CORPORATE_TAX_RATE);

  return {
    currency: BASE_CURRENCY,
    vatByCountry,
    vatTotal,
    profitBase: round2(net),
    corporateTaxEstimate,
    corporateTaxRate: CORPORATE_TAX_RATE,
    notes: [
      "TVA collectée à reverser (régime OSS pour l'UE), ventilée par pays de destination.",
      `IS estimé au taux de ${(CORPORATE_TAX_RATE * 100).toFixed(0)} % sur la marge nette de la période — indicatif, pas la liasse annuelle.`,
      "La TVA collectée est exclue de la marge nette (c'est une dette, pas un revenu).",
    ],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
