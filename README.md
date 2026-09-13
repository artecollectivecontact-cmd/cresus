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
      pennylane.ts      → ✅ implémenté (API v2, parsing défensif à revérifier)
      artelo.ts         → ✅ implémenté (best-effort, base + champs à confirmer)
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

Le repo est prêt (branche `main`). Étapes :

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → choisir
   `artecollectivecontact-cmd/cresus`. Framework auto-détecté : **Next.js**
   (build `next build`, aucune config à changer).
2. **Production Branch** : mettre `main` (Settings → Git, si ce n'est pas déjà le cas).
3. **Environment Variables** : ajouter les clés (voir `.env.example` pour la liste
   complète). Minimum pour du réel : `SHOPIFY_SHOP` + `SHOPIFY_ADMIN_TOKEN`.
   Ajouter ensuite `PRINTIFY_API_TOKEN`, `PRODIGI_API_KEY`, etc.
4. **Deploy**. Chaque source passe de **démo** à **direct** automatiquement dès
   que ses clés sont présentes — pas besoin de toucher au code.

> Sans aucune clé, le site se déploie quand même et tourne en **mode démo**.
> Ajouter les clés après coup ne demande qu'un *Redeploy*.

## Où en est chaque connecteur

| Source | État | Ce qu'il manque pour le direct |
|---|---|---|
| Shopify | ✅ live-ready | `SHOPIFY_SHOP` + `SHOPIFY_ADMIN_TOKEN` (scope `read_orders`) |
| Printify | ✅ live-ready | `PRINTIFY_API_TOKEN` |
| Prodigi | ✅ live-ready | `PRODIGI_API_KEY` |
| Qonto | ✅ live-ready | `QONTO_LOGIN` + `QONTO_SECRET_KEY` |
| Meta Ads | ✅ live-ready | `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` |
| Pennylane | ✅ implémenté | `PENNYLANE_API_TOKEN` — parsing des champs à revérifier avec une vraie clé (doc inaccessible au build) |
| Artelo | ✅ implémenté | `ARTELO_API_KEY` (+ `ARTELO_BASE`) — URL de base et noms de champs coût à confirmer |

## Anti double-comptage & rapprochement (`COST_BASIS`)

Le même euro dépensé peut apparaître dans plusieurs sources (une pub Meta est
dans Meta Ads **et** dans Pennylane **et** dans Qonto). Pour ne jamais le compter
deux fois dans la marge :

- **`COST_BASIS=connectors`** (défaut) : la marge jour/heure s'appuie sur les
  coûts **granulaires** (POD par commande + Meta). Pennylane (compta) et Qonto
  (banque) deviennent un **rapprochement** — affichés à part, jamais re-sommés.
  Un écart marge ↔ compta est signalé pour repérer un coût manquant.
- **`COST_BASIS=pennylane`** : les **charges comptabilisées** dans Pennylane
  pilotent la marge (rapprochement de tout), et les connecteurs POD/Meta
  redeviennent un simple repère détaillé.

C'est piloté par le flag `reconcileOnly` posé dans `pnl.ts` : les connecteurs ne
connaissent pas la politique, ils remontent juste leurs écritures.

## Notes importantes

- **COGS estimé** : en base `connectors`, tant que Printify/Prodigi/Artelo ne
  renvoient pas de coûts réels, le coût de production est estimé
  (`ESTIMATED_COGS_RATE`) et **clairement marqué « est. »** dans l'UI. Dès qu'un
  connecteur POD est en direct, les vrais coûts prennent le relais.
- **Fiscalité indicative** : les projections TVA/IS sont des ordres de grandeur,
  pas la liasse comptable.
