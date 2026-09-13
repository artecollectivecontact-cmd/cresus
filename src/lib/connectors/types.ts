import type { LedgerEntry, SourceId } from "../types";

// ---------------------------------------------------------------------------
// Contrat commun à tous les connecteurs. Ajouter une nouvelle source = écrire
// un module qui implémente `Connector` et l'enregistrer dans index.ts.
// ---------------------------------------------------------------------------

export interface DateRange {
  /** Inclus, ISO UTC. */
  from: string;
  /** Exclus, ISO UTC. */
  to: string;
}

export type ConnectorState = "live" | "demo" | "stub" | "error";

export interface FetchResult {
  entries: LedgerEntry[];
  state: ConnectorState;
  detail: string;
}

export interface Connector {
  id: SourceId;
  label: string;
  /** true si les variables d'env nécessaires sont présentes. */
  isConfigured(): boolean;
  /**
   * Récupère les écritures normalisées sur la période.
   * Ne doit jamais throw : en cas d'échec, renvoyer state:"error" avec le détail.
   */
  fetch(range: DateRange): Promise<FetchResult>;
}
