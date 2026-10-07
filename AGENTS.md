# AGENTS.md — Exchange DB Balancer

## But
Application web qui lit un CSV de boîtes aux lettres Exchange, les répartit
sur N bases de destination (1 à 5) avec des tailles les plus proches possibles,
puis génère un CSV par base et les commandes PowerShell de migration.

## Stack (ne pas en changer sans demande explicite)
- Next.js (App Router), TypeScript strict, Tailwind
- PapaParse, Zod, JSZip, Vitest
- Gestionnaire de paquets : pnpm
- Déploiement : Vercel (branche main) ; code sur GitHub

## Contraintes non négociables
- 100 % client-side : aucune donnée CSV envoyée à un serveur, aucun
  stockage persistant, aucun tracker/analytics, aucune requête réseau
  contenant des données utilisateur.
- Pas de dépendance non nécessaire. Justifier toute nouvelle dépendance.
- Interface en français.
- La logique métier (parsing, répartition, génération de commandes) vit dans
  `src/lib/` en fonctions pures, sans dépendance à React, et est testée.

## Structure
- src/lib/parse.ts        parsing CSV + normalisation des tailles
- src/lib/balance.ts      algorithme de répartition
- src/lib/exchange.ts     génération des CSV de batch + commandes PowerShell
- src/components/         UI (wizard par étapes)
- tests/                  Vitest + fixtures CSV fictives (jamais de vraies données)

## Format d'entrée (référence)
Colonnes : DisplayName, Alias, SamAccountName, UserPrincipalName, FirstName,
LastName, MailboxSizeMB. Séparateur virgule, en-têtes, MailboxSizeMB en
mégaoctets avec point décimal (ex. 1.52). Colonnes supplémentaires tolérées
et conservées dans les CSV exportés.

## Règles de code
- Aucun `any`. Entrées validées avec Zod.
- Taille : nombre décimal en MB ; accepter aussi la virgule décimale ("1,52")
  par tolérance ; rejeter négatif, vide ou non numérique avec un message clair.
- Erreurs de CSV (colonne manquante, taille illisible, doublons d'email)
  affichées clairement, jamais avalées.
- Noms de bases validés (non vides, uniques) et échappés dans les commandes.
- SÉCURITÉ POWERSHELL : ne jamais interpoler de valeur issue du CSV dans une
  chaîne entre guillemets doubles (SamAccountName commence par "$"). Utiliser
  des quotes simples avec doublement des apostrophes, ou ne pas injecter la
  valeur du tout.
  
## Commandes
- pnpm dev | pnpm build | pnpm lint | pnpm test | pnpm typecheck

## Définition de « terminé »
lint + typecheck + tests + build passent. Les tests de l'algo couvrent :
1 base, 5 bases, boîte énorme, tailles égales, moins de boîtes que de bases.
Le README explique l'usage et le déploiement Vercel.

## Façon de travailler
- Proposer un plan court avant de coder, puis avancer par jalons commités.
- En cas d'ambiguïté fonctionnelle, poser la question plutôt que supposer.
- Ne jamais committer de données réelles.
