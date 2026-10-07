# Exchange DB Balancer

Répartit des boîtes aux lettres Exchange Server (on-prem) sur 1 à 5 bases de
destination de taille la plus proche possible, puis génère les fichiers et les
commandes de migration.

Le parcours est un wizard en six étapes : **Import** du CSV →
**Mapping** taille/adresse → **nombre de bases** → **noms des bases** →
**répartition** calculée automatiquement → **Export** (CSV par base,
commandes `New-MigrationBatch`, script `.ps1` complet, ZIP de tout).

Tout se passe dans le navigateur : le fichier CSV n'est jamais envoyé sur
internet, rien n'est stocké (pas de `localStorage`), aucun tracker.

## Format du CSV d'entrée

Séparateur détecté automatiquement : virgule, point-virgule ou tabulation.
Les exports de serveurs français sont le plus souvent en point-virgule
(`Export-Csv` utilise le séparateur de la culture du système) : importez le
fichier tel quel. Première ligne = en-têtes. Boîtes principales uniquement
(pas les archives).

| Colonne | Obligatoire | Exemple |
|---|---|---|
| DisplayName | non | Dupont Alice |
| Alias | non | adupont |
| SamAccountName | non | a.dupont |
| UserPrincipalName | oui (adresse du batch) | alice.dupont@exemple.fr |
| FirstName | non | Alice |
| LastName | non | Dupont |
| MailboxSizeMB | oui (taille en Mo) | 1840.5 |

Les colonnes supplémentaires sont tolérées et conservées dans les CSV
exportés. La taille est un nombre décimal en mégaoctets, point décimal en
référence (`1.52`) ; la virgule décimale (`1,52`) est tolérée. Les suffixes
d'unité (`Mo`, `Go`, `512 Mo`) sont acceptés au cas où, mais inutiles.

Un exemple fictif de dix lignes est fourni : charger `/exemple.csv` depuis
l'étape Import pour tester l'application.

## Produire le CSV d'entrée (Exchange Management Shell)

Sur le serveur Exchange on-prem, dans l'Exchange Management Shell :

```powershell
$rows = foreach ($mb in Get-Mailbox -ResultSize Unlimited) {
    $stats = Get-MailboxStatistics -Identity $mb.Identity
    [pscustomobject]@{
        DisplayName       = $mb.DisplayName
        Alias             = $mb.Alias
        SamAccountName    = $mb.SamAccountName
        UserPrincipalName = $mb.UserPrincipalName
        FirstName         = $mb.FirstName
        LastName          = $mb.LastName
        MailboxSizeMB     = [math]::Round(
            $stats.TotalItemSize.Value.ToBytes() / 1MB, 2
        ).ToString([cultureinfo]::InvariantCulture)
    }
}
$rows | Export-Csv -Path .\mailboxes.csv -NoTypeInformation -Encoding UTF8 -Delimiter ','
```

Quelques notes sur cette commande :

- `Get-MailboxStatistics` fait **un appel par boîte** : sur plusieurs
  milliers de boîtes, comptez plusieurs minutes. `TotalItemSize` sans
  `-Archive` mesure la boîte principale uniquement, ce qui correspond à ce
  que migre le batch.
- `-Delimiter ','` force la virgule ; sans lui, `Export-Csv` utilise le
  séparateur de la culture du système, soit `;` sur un serveur français.
  L'application lit les deux, donc vous pouvez l'omettre si vous préférez
  le format par défaut.
- `.ToString([cultureinfo]::InvariantCulture)` force le point décimal, que
  l'application lit en référence (la virgule passe aussi, mais le point est
  le format attendu).
- Pour Exchange Online, remplacez `Get-Mailbox` par `Get-ExoMailbox` et
  `Get-MailboxStatistics` par `Get-ExoMailboxStatistics` (la syntaxe du
  reste est identique).

## Ce que produit l'export

Pour chaque base non vide :

- un CSV `batch-<nom>.csv` **toujours en virgules** (c'est ce qu'exige
  `New-MigrationBatch -CSVData`), avec `EmailAddress` en première colonne
  suivi de toutes les colonnes d'origine dans leur ordre initial ;
- une commande `New-MigrationBatch` avec les paramètres éditables (nom du
  batch, `-AutoStart`, `-AutoComplete`, `-BadItemLimit`, `-LargeItemLimit`,
  `-NotificationEmails`).

Et pour l'ensemble : un script `migration-batches.ps1` qui crée tous les
batchs en une fois (supporte `-WhatIf`, réutilise un batch déjà présent au
lieu de le dupliquer) et un récapitulatif `repartition.txt`.

Une base sans aucune boîte ne produit ni CSV ni commande : un batch sans
destinataire échouerait sur le serveur.

## Avant de lancer la migration

L'application affiche ces avertissements à l'étape Export, mais elle ne
peut pas les vérifier elle-même :

- **Espace disque** — la répartition ne connaît que la taille des boîtes,
  pas la place restante sur les volumes. Une migration a besoin de la taille
  des données **plus** la copie en cours de déplacement **plus** les
  journaux de transaction. Prévoyez au moins le double de la taille totale
  par base.
- **Journaux de transaction** — la croissance doit être activée sur les
  bases de destination, sinon la migration bloque dès que le journal est
  plein.
- **`-AutoComplete`** — sans lui, le batch s'arrête sans être finalisé et
  les boîtes ne sont pas déplacées. Finalisez avec
  `Complete-MigrationBatch`, ou cochez la case dans l'outil.

## Développement

Prérequis : Node 20+ et pnpm.

```bash
pnpm install
pnpm dev        # serveur de développement
pnpm lint       # ESLint
pnpm typecheck  # tsc --noEmit
pnpm test       # Vitest
pnpm build      # export statique dans out/
```

La logique métier (`src/lib/`) est en fonctions pures sans dépendance à
React et est couverte par des tests. Ne commitez jamais de données réelles :
les `*.csv` sont ignorés sauf `tests/fixtures/*.csv` et
`public/exemple.csv`, qui sont fictifs.

## Déploiement sur Vercel

Aucune configuration requise :

1. Poussez la branche `main` sur GitHub.
2. Importez le dépôt dans Vercel (framework détecté automatiquement :
   Next.js, gestionnaire détecté via `pnpm-lock.yaml`).
3. Déployez : `pnpm build` produit un export statique (`output: 'export'`),
   ce qui garantit par construction qu'aucune donnée ne transite par un
   serveur.

## Limites connues

- Les tailles sont lues avec une précision au centième de Mo ; l'écart
  affiché entre bases peut différer légèrement d'un calcul en octets.
- Le contrôle qualité signale les 200 premiers problèmes ; les lignes au-delà
  sont comptées mais non détaillées.
- Pour ouvrir les CSV exportés dans Excel en français (qui attend `;`),
  utilisez Données > À partir d'un texte/CSV et choisissez la virgule comme
  délimiteur.

## Licence

MIT.
