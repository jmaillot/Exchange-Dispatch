# AGENTS.md — Exchange DB Balancer

## But
Application web qui lit un CSV de boîtes aux lettres Exchange Server (on-prem),
les répartit sur N bases de destination (1 à 5) avec des tailles les plus
proches possibles, puis génère un CSV par base et les commandes PowerShell
de création des batchs de migration.

## Stack (ne pas en changer sans demande explicite)
- Next.js (App Router), TypeScript strict, Tailwind
- PapaParse, Zod, JSZip, Vitest
- Gestionnaire de paquets : pnpm
- Code sur GitHub, déploiement Vercel (branche main)

## Contraintes non négociables
- 100 % client-side : aucune donnée CSV envoyée à un serveur, aucun stockage
  persistant (pas de localStorage des données), aucun tracker/analytics,
  aucune requête réseau contenant des données utilisateur.
- Pas de dépendance superflue. Justifier toute nouvelle dépendance.
- Interface en français.
- Logique métier dans `src/lib/`, en fonctions pures sans React, testée.

## Format d'entrée (référence)
Colonnes : DisplayName, Alias, SamAccountName, UserPrincipalName, FirstName,
LastName, MailboxSizeMB. Séparateur virgule, en-têtes, MailboxSizeMB en
mégaoctets avec point décimal (ex. 1.52), boîte principale uniquement.
Colonnes supplémentaires tolérées et conservées. Pas de colonne "base
actuelle" : l'équilibrage ne dépend pas de l'existant.

## Structure
- src/lib/parse.ts      parsing CSV, validation, normalisation
- src/lib/balance.ts    algorithme de répartition
- src/lib/exchange.ts   génération des CSV et des commandes PowerShell
- src/components/       UI (wizard par étapes)
- tests/                Vitest + fixtures fictives (jamais de vraies données)
- public/exemple.csv    exemple fictif au format ci-dessus

## Règles de code
- Aucun `any`. Entrées validées avec Zod.
- Taille : nombre décimal en MB ; accepter aussi la virgule décimale
  ("1,52") par tolérance ; rejeter vide, négatif ou non numérique avec un
  message clair indiquant la ligne.
- Erreurs de CSV (colonne manquante, taille illisible, doublons d'email)
  affichées clairement, jamais avalées.
- Noms de bases validés (non vides, uniques, sans espace ni caractère
  spécial) et échappés dans les commandes.
- SÉCURITÉ POWERSHELL : ne jamais interpoler de valeur issue du CSV dans une
  chaîne entre guillemets doubles (SamAccountName commence par "$"). Utiliser
  des quotes simples avec doublement des apostrophes, ou ne pas injecter la
  valeur.

## Algorithme (référence)
Partitionnement multi-voies : tri décroissant + affectation gloutonne à la
base la moins remplie (LPT), puis amélioration locale (déplacements et
échanges entre bases) tant que l'écart max-min diminue. Déterministe
(mêmes entrées = mêmes sorties, tri stable avec départage sur l'email).

## Commandes
pnpm dev | pnpm build | pnpm lint | pnpm test | pnpm typecheck

## Définition de « terminé »
lint + typecheck + tests + build passent. Les tests couvrent : 1 base,
5 bases, une boîte plus grosse que la moyenne, tailles identiques, moins de
boîtes que de bases, CSV invalide. Le README explique l'usage, le format
attendu, l'export PowerShell conseillé pour produire le CSV d'entrée, et le
déploiement Vercel.

## Façon de travailler
- Plan court avant de coder, puis jalons commités.
- En cas d'ambiguïté fonctionnelle, poser la question plutôt que supposer.
- Ne jamais committer de données réelles.
