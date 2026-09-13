import type { Connector } from "./types";
import { shopifyConnector } from "./shopify";
import { printifyConnector } from "./printify";
import { prodigiConnector } from "./prodigi";
import { arteloConnector } from "./artelo";
import { qontoConnector } from "./qonto";
import { pennylaneConnector } from "./pennylane";
import { metaConnector } from "./meta";

// Ordre d'affichage dans le tableau de bord.
export const connectors: Connector[] = [
  shopifyConnector,
  printifyConnector,
  prodigiConnector,
  arteloConnector,
  qontoConnector,
  pennylaneConnector,
  metaConnector,
];

export * from "./types";
