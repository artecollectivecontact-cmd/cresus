import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Pennylane — compta / rapprochement (charges comptabilisées).
// API v2 : base https://app.pennylane.com/api/external/v2  (Bearer token).
// Scope requis : supplier_invoices:readonly.
//
// ⚠️ La doc Pennylane (pennylane.readme.io) est inaccessible depuis
// l'environnement de build (bloquée par la politique réseau), donc le mapping
// de champs ci-dessous est DÉFENSIF : on gère plusieurs noms possibles pour le
// montant / la date / la pagination. À revérifier avec une vraie clé — les
// helpers `pickNumber` / `pickString` isolent les 3 champs à confirmer.
//
// Rôle : Pennylane sert de source de RAPPROCHEMENT (voir COST_BASIS dans
// config.ts). En base "connectors", ses écritures sont marquées reconcileOnly
// par pnl.ts et ne sont pas re-sommées dans la marge.
// ---------------------------------------------------------------------------

const ENV = ["PENNYLANE_API_TOKEN"];
const BASE = process.env.PENNYLANE_BASE || "https://app.pennylane.com/api/external/v2";

type Json = Record<string, unknown>;

function pickNumber(o: Json, keys: string[]): number {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  }
  return 0;
}
function pickString(o: Json, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (v && typeof v === "object" && "name" in (v as Json)) {
      const n = (v as Json).name;
      if (typeof n === "string") return n;
    }
  }
  return undefined;
}

export const pennylaneConnector: Connector = {
  id: "pennylane",
  label: "Pennylane",
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (PENNYLANE_API_TOKEN)" };
    }
    const token = process.env.PENNYLANE_API_TOKEN!;
    const fromMs = new Date(range.from).getTime();
    const toMs = new Date(range.to).getTime();
    try {
      const entries: LedgerEntry[] = [];
      let cursor: string | null = null;
      let page = 1;
      let guard = 0;

      // eslint-disable-next-line no-constant-condition
      while (guard++ < 200) {
        const params = new URLSearchParams();
        // v2 : pagination par cursor ; fallback page si l'API l'accepte.
        if (cursor) params.set("cursor", cursor);
        else params.set("page", String(page));
        params.set("limit", "100");

        const res = await fetch(`${BASE}/supplier_invoices?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Pennylane HTTP ${res.status}`);
        const data = (await res.json()) as Json;

        const list: Json[] =
          (data.items as Json[]) ||
          (data.supplier_invoices as Json[]) ||
          (data.data as Json[]) ||
          [];

        for (const inv of list) {
          const dateStr = pickString(inv, ["date", "invoice_date", "created_at", "deadline"]);
          if (!dateStr) continue;
          const ts = new Date(dateStr).getTime();
          if (isNaN(ts) || ts < fromMs || ts >= toMs) continue;
          // Montant TTC de la charge. On tente HT si dispo, sinon TTC.
          const amount = pickNumber(inv, [
            "amount",
            "currency_amount",
            "total_amount",
            "amount_with_tax",
            "gross_amount",
          ]);
          if (amount <= 0) continue;
          const currency = pickString(inv, ["currency"]) || "EUR";
          const label = pickString(inv, ["label", "supplier", "supplier_name", "external_reference"]) || "Charge Pennylane";
          const id = pickString(inv, ["id", "public_id"]) || `${dateStr}-${amount}`;
          entries.push({
            id: `pennylane:inv:${id}`,
            source: "pennylane",
            kind: "expense",
            occurredAt: new Date(ts).toISOString(),
            amount: -Math.abs(amount),
            currency,
            label,
          });
        }

        const hasMore = Boolean(data.has_more);
        const nextCursor = pickString(data, ["next_cursor"]);
        if (hasMore && nextCursor) {
          cursor = nextCursor;
        } else if (!cursor && list.length === 100) {
          page++; // pagination par page si pas de cursor
        } else {
          break;
        }
      }

      return { entries, state: "live", detail: `${entries.length} charges` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
