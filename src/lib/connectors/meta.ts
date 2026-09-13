import type { Connector, DateRange, FetchResult } from "./types";
import type { LedgerEntry } from "../types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Meta Ads — dépense publicitaire journalière.
// Graph API Insights : https://developers.facebook.com/docs/marketing-api/insights
// On récupère le "spend" ventilé par jour (time_increment=1).
// ---------------------------------------------------------------------------

const ENV = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"];
const VERSION = process.env.META_API_VERSION || "v21.0";

interface Insight {
  spend?: string;
  date_start?: string;
  account_currency?: string;
}

export const metaConnector: Connector = {
  id: "meta",
  label: "Meta Ads",
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (META_ACCESS_TOKEN)" };
    }
    const token = process.env.META_ACCESS_TOKEN!;
    const acct = process.env.META_AD_ACCOUNT_ID!; // format "act_123456"
    try {
      const since = range.from.slice(0, 10);
      // `until` inclusif côté Meta : on recule d'un jour la borne exclusive.
      const untilDate = new Date(new Date(range.to).getTime() - 86400000);
      const until = untilDate.toISOString().slice(0, 10);
      const url =
        `https://graph.facebook.com/${VERSION}/${acct}/insights` +
        `?fields=spend,account_currency&level=account&time_increment=1` +
        `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
        `&access_token=${encodeURIComponent(token)}`;

      const entries: LedgerEntry[] = [];
      let next: string | null = url;
      while (next) {
        const res: Response = await fetch(next, { cache: "no-store" });
        if (!res.ok) throw new Error(`Meta HTTP ${res.status}`);
        const data = (await res.json()) as { data: Insight[]; paging?: { next?: string } };
        for (const row of data.data ?? []) {
          const spend = Number(row.spend ?? 0);
          if (spend > 0 && row.date_start) {
            entries.push({
              id: `meta:spend:${row.date_start}`,
              source: "meta",
              kind: "ads",
              occurredAt: `${row.date_start}T12:00:00Z`,
              amount: -spend,
              currency: row.account_currency || "EUR",
              label: `Pub Meta ${row.date_start}`,
            });
          }
        }
        next = data.paging?.next ?? null;
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
