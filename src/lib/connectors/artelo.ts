import type { Connector, DateRange, FetchResult } from "./types";
import { hasEnv } from "../config";

// ---------------------------------------------------------------------------
// Connecteur Artelo — fournisseur POD (impression) => source de COÛT.
//
// STUB : pas d'API publique clairement identifiée à ce stade. Deux options une
// fois confirmé avec l'équipe :
//   1) API REST Artelo (si elle existe) -> même schéma que Printify/Prodigi
//      (récupérer le coût de prod + expédition par commande, montant NÉGATIF,
//       kind "cogs"/"fulfillment", rattaché au n° de commande Shopify via `ref`).
//   2) Sinon, import CSV/Sheet des coûts fournisseur -> à brancher ici.
// Le reste de l'app est déjà prêt à consommer ces écritures normalisées.
// ---------------------------------------------------------------------------

const ENV = ["ARTELO_API_KEY"];

export const arteloConnector: Connector = {
  id: "artelo",
  label: "Artelo",
  isConfigured: () => hasEnv(ENV),

  async fetch(_range: DateRange): Promise<FetchResult> {
    if (!hasEnv(ENV)) {
      return { entries: [], state: "stub", detail: "API/coûts Artelo à brancher (POD)" };
    }
    return { entries: [], state: "stub", detail: "clé présente — endpoint Artelo à implémenter" };
  },
};
