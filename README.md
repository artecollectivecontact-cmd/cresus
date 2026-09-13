# Crésus 💰

**Analyse financière journalière (et heure par heure) d'Arte Collective.**

Centralise tout l'argent qui rentre et qui sort — Shopify, Printify, Prodigi, Artelo, Qonto, Pennylane, Meta Ads — pour répondre à une seule question chaque jour :

> **On a gagné combien ? On a payé combien ? La journée a-t-elle été rentable ?**

---

## Ce que fait l'app

- **Récupère le CA** depuis Shopify (commandes, TVA, port) en direct.
- **Récupère les coûts POD** (production + expédition) depuis Printify / Prodigi / Artelo.
- **Récupère les dépenses réelles** depuis Qonto (banque) et Pennylane (compta).
- **Récupère la dépense pub** journalière depuis Meta Ads.
- **Normalise tout** en écritures comptables dans une **devise unique (EUR)**, taux de change BCE.
- **Calcule la marge nette** jour par jour et **heure par heure** (fuseau Europe/Paris).
- **Projette la TVA** à reverser (ventilée par pays, régime OSS) et **l'IS estimé**.

Tant qu'une clé API n'est pas branchée, l'app tourne en **mode démo** (vraies commandes Shopify du jour + historique de démonstration + coûts POD estimés) pour que le dashboard soit utilisable tout de suite.

## Architecture

```
src/
  app/
    page.tsx            → tableau de bord (server component)
    api/pnl/route.ts    → rapport P&L en JSON (/api/pnl?days=14&focusDay=YYYY-MM-DD)
  lib/
    types.ts            → modèle de données central (LedgerEntry, PnLReport…)
    config.ts           → réglages via variables d'env (devise, taux, TVA)
    fx.ts               → conversion de devises (BCE / taux figés)
    tax.ts              → projection TVA par pays + IS
    pnl.ts              → moteur d'agrégation (jour/heure, par source)
    sample-data.ts      → données de démo (amorcées avec de vraies commandes)
    connectors/
      types.ts          → contrat commun `Connector`
      shopify.ts        → ✅ implémenté (Admin GraphQL API)
      printify.ts       → ✅ implémenté (REST)
      prodigi.ts        → ✅ implémenté (REST)
      qonto.ts          → ✅ implémenté (REST)
      meta.ts           → ✅ implémenté (Graph Insights)
      pennylane.ts      → 🚧 stub (endpoint à confirmer)
      artelo.ts         → 🚧 stub (API/coûts à brancher)
  components/dashboard.tsx → UI (KPI, graphes, panneaux)
```

**Ajouter une source** = écrire un module qui implémente `Connector` (une méthode `fetch(range)` qui renvoie des `LedgerEntry` normalisées) et l'enregistrer dans `src/lib/connectors/index.ts`. Le reste (conversion, agrégation, TVA, UI) le consomme automatiquement.

## Démarrer en local

```bash
npm install
cp .env.example .env.local   # remplis les clés que tu as (facultatif : démo sans clé)
npm run dev                  # http://localhost:3000
```

## Déploiement Vercel

1. Pousser ce repo sur GitHub.
2. Sur Vercel : *New Project* → importer le repo (framework détecté : Next.js).
3. Onglet **Settings → Environment Variables** : coller les clés de `.env.example`.
4. Deploy. Chaque source passe automatiquement de **démo** à **direct** dès que ses clés sont présentes.

## Où en est chaque connecteur

| Source | État | Ce qu'il manque pour le direct |
|---|---|---|
| Shopify | ✅ live-ready | `SHOPIFY_SHOP` + `SHOPIFY_ADMIN_TOKEN` (scope `read_orders`) |
| Printify | ✅ live-ready | `PRINTIFY_API_TOKEN` |
| Prodigi | ✅ live-ready | `PRODIGI_API_KEY` |
| Qonto | ✅ live-ready | `QONTO_LOGIN` + `QONTO_SECRET_KEY` |
| Meta Ads | ✅ live-ready | `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` |
| Pennylane | 🚧 stub | confirmer l'endpoint (charges vs factures) pour éviter le double comptage avec Qonto |
| Artelo | 🚧 stub | identifier l'API / la source des coûts (POD) |

## Notes importantes

- **COGS estimé** : tant que Printify/Prodigi/Artelo ne renvoient pas de coûts réels, le coût de production est estimé (`ESTIMATED_COGS_RATE`) et **clairement marqué comme estimation** dans l'UI. Dès qu'un connecteur POD est en direct, les vrais coûts prennent le relais.
- **Éviter le double comptage** : Qonto encaisse le CA Shopify — on ignore ces crédits (`QONTO_IGNORE_LABELS`) pour ne pas compter le revenu deux fois. Même logique à prévoir entre Qonto et Pennylane.
- **Fiscalité indicative** : les projections TVA/IS sont des ordres de grandeur, pas la liasse comptable.
