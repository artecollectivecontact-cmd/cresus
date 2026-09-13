import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Qonto — flux bancaires réels (dépenses et entrées).
// API : https://api-doc.qonto.com  (header Authorization: "login:secret_key").
//
// Sert de source de vérité "cash" à côté des estimations : abonnements, frais
// bancaires, virements... On classe les débits en "expense" et on ignore les
// crédits liés aux paiements Shopify pour ne pas double-compter le CA
// (filtrable via QONTO_IGNORE_LABELS).
// ---------------------------------------------------------------------------

const ENV = ["QONTO_LOGIN", "QONTO_SECRET_KEY"];
const BASE = "https://thirdparty.qonto.com/v2";

interface Transaction {
  transaction_id: string;
  amount: number;
  currency: string;
  side: "debit" | "credit";
  emitted_at: string;
  label?: string;
  clean_counterparty_name?: string;
}

export const qontoConnector: Connector = {
  id: "qonto",
  label: "Qonto",
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (QONTO_LOGIN/SECRET)" };
    }
    const auth = `${process.env.QONTO_LOGIN}:${process.env.QONTO_SECRET_KEY}`;
    const iban = process.env.QONTO_IBAN; // optionnel : cible un compte précis
    const ignore = (process.env.QONTO_IGNORE_LABELS || "shopify,stripe")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    try {
      const entries: LedgerEntry[] = [];
      let page = 1;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const params = new URLSearchParams({
          current_page: String(page),
          per_page: "100",
          "emitted_at_from": range.from,
          "emitted_at_to": range.to,
        });
        if (iban) params.set("iban", iban);
        const res = await fetch(`${BASE}/transactions?${params.toString()}`, {
          headers: { Authorization: auth },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Qonto HTTP ${res.status}`);
        const data = (await res.json()) as {
          transactions: Transaction[];
          meta?: { next_page: number | null };
        };
        for (const t of data.transactions ?? []) {
          const name = (t.clean_counterparty_name || t.label || "").toLowerCase();
          if (ignore.some((k) => name.includes(k))) continue; // évite le double comptage du CA
          if (t.side !== "debit") continue; // on ne garde que les sorties comme charges
          entries.push({
            id: `qonto:tx:${t.transaction_id}`,
            source: "qonto",
            kind: "expense",
            occurredAt: t.emitted_at,
            amount: -Math.abs(t.amount),
            currency: t.currency,
            label: t.clean_counterparty_name || t.label || "Dépense Qonto",
          });
        }
        const nextPage = data.meta?.next_page ?? null;
        if (!nextPage) break;
        page = nextPage;
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
