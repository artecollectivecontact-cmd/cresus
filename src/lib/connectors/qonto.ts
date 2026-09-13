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

interface BankAccount {
  bank_account_id?: string;
  id?: string;
  iban?: string;
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
    const headers = { Authorization: auth, Accept: "application/json" };
    const onlyIban = process.env.QONTO_IBAN; // optionnel : cible un compte précis
    const ignore = (process.env.QONTO_IGNORE_LABELS || "shopify,stripe")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    try {
      // 1) L'endpoint transactions EXIGE un compte : on récupère d'abord les
      //    comptes bancaires de l'organisation.
      const orgRes = await fetch(`${BASE}/organization`, { headers, cache: "no-store" });
      if (!orgRes.ok) throw new Error(`Qonto HTTP ${orgRes.status} (organization)`);
      const org = (await orgRes.json()) as {
        organization?: { bank_accounts?: BankAccount[] };
      };
      let accounts = org.organization?.bank_accounts ?? [];
      if (onlyIban) accounts = accounts.filter((a) => a.iban === onlyIban);
      if (accounts.length === 0) {
        return { entries: [], state: "live", detail: "aucun compte bancaire" };
      }

      // 2) Transactions par compte (bank_account_id), paginées.
      const entries: LedgerEntry[] = [];
      for (const acct of accounts) {
        const acctId = acct.bank_account_id || acct.id;
        let page = 1;
        let guard = 0;
        // eslint-disable-next-line no-constant-condition
        while (guard++ < 50) {
          const params = new URLSearchParams({
            current_page: String(page),
            per_page: "100",
            emitted_at_from: range.from,
            emitted_at_to: range.to,
          });
          if (acctId) params.set("bank_account_id", acctId);
          else if (acct.iban) params.set("iban", acct.iban);
          const res = await fetch(`${BASE}/transactions?${params.toString()}`, {
            headers,
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`Qonto HTTP ${res.status} (transactions)`);
          const data = (await res.json()) as {
            transactions?: Transaction[];
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
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
