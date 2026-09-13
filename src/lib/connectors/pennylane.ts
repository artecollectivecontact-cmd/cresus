import type { Connector, DateRange, FetchResult } from "./types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Pennylane — compta (factures fournisseurs, charges comptabilisées).
// API : https://pennylane.readme.io  (Bearer token, endpoints /api/external/v2).
//
// STUB volontaire : Pennylane a plusieurs modèles (supplier_invoices,
// customer_invoices, transactions) selon ton usage. On laisse le squelette prêt
// et on précisera l'endpoint exact (charges vs factures) avant de l'activer,
// pour ne pas double-compter avec Qonto.
// ---------------------------------------------------------------------------

const ENV = ["PENNYLANE_API_TOKEN"];

export const pennylaneConnector: Connector = {
  id: "pennylane",
  label: "Pennylane",
  isConfigured: () => hasEnv(ENV),

  async fetch(_range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "clé absente (PENNYLANE_API_TOKEN)" };
    }
    // TODO: mapper supplier_invoices -> écritures "expense" une fois l'usage confirmé.
    return {
      entries: [],
      state: "stub",
      detail: "clé présente — endpoint à confirmer (charges vs factures) pour éviter le double comptage avec Qonto",
    };
  },
};
