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
  country?: string;
}

export const metaConnector: Connector = {
  id: "meta",
  label: "Meta Ads",
  isConfigured: () => hasEnv(ENV),

  async fetch(range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      const missing = ENV.filter((k) => !process.env[k] || !process.env[k]!.trim());
      return { entries: [], state: "stub", detail: `clé absente : ${missing.join(" + ")}` };
    }
    const token = process.env.META_ACCESS_TOKEN!;
    const acct = process.env.META_AD_ACCOUNT_ID!; // format "act_123456"
    const since = range.from.slice(0, 10);
    const until = range.to.slice(0, 10); // inclut AUJOURD'HUI (until est inclusif côté Meta)

    const buildUrl = (withCountry: boolean): string =>
      `https://graph.facebook.com/${VERSION}/${acct}/insights` +
      `?fields=spend,account_currency&level=account&time_increment=1` +
      (withCountry ? `&breakdowns=country` : "") +
      `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
      `&limit=500&access_token=${encodeURIComponent(token)}`;

    const run = async (withCountry: boolean): Promise<LedgerEntry[]> => {
      const entries: LedgerEntry[] = [];
      let next: string | null = buildUrl(withCountry);
      while (next) {
        const res: Response = await fetch(next, { cache: "no-store" });
        if (!res.ok) throw new Error(`Meta HTTP ${res.status}`);
        const data = (await res.json()) as { data: Insight[]; paging?: { next?: string } };
        for (const row of data.data ?? []) {
          const spend = Number(row.spend ?? 0);
          if (spend > 0 && row.date_start) {
            const c = withCountry ? row.country : undefined;
            entries.push({
              id: `meta:spend:${row.date_start}:${c ?? "all"}`,
              source: "meta",
              kind: "ads",
              occurredAt: `${row.date_start}T12:00:00Z`,
              amount: -spend,
              currency: row.account_currency || "USD",
              label: `Pub Meta ${row.date_start}${c ? ` (${c})` : ""}`,
              country: c, // pays du ciblage -> région (US/UK/EU)
            });
          }
        }
        next = data.paging?.next ?? null;
      }
      return entries;
    };

    try {
      // Dépense ventilée par pays (pour le ROAS/la marge par région). Si le
      // compte refuse la ventilation, on retombe sur le total compte.
      let entries: LedgerEntry[];
      try {
        entries = await run(true);
      } catch {
        entries = await run(false);
      }
      return { entries, state: "live", detail: `${entries.length} écritures` };
    } catch (e) {
      return { entries: [], state: "error", detail: (e as Error).message };
    }
  },
};
