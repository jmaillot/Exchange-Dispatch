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
- une commande `New-MigrationBatch -Local` avec les paramètres éditables
  (nom du batch, `-AutoStart`, `-AutoComplete`, `-BadItemLimit`,
  `-NotificationEmails`), la base cible (`-TargetDatabases`) et
  `-AllowUnknownColumnsInCsv` (nos CSV conservent les colonnes d'origine).
  `-LargeItemLimit` n'existe pas dans le jeu de paramètres « Local » et
  n'est donc pas émis.

Et pour l'ensemble : un script `migration-batches.ps1` qui crée tous les
batchs en une fois (supporte `-WhatIf`, réutilise un batch déjà présent au
lieu de le dupliquer) et un récapitulatif `repartition.txt`.

Une base sans aucune boîte ne produit ni CSV ni commande : un batch sans
destinataire échouerait sur le serveur.

## Côté serveur Exchange

La même marche à suivre est affichée dans l'application (étape Export) et en
commentaire en tête du script `.ps1`.

1. **Copier les fichiers sur le serveur** — le script `.ps1` et tous les
   `batch-*.csv` du ZIP, dans un même dossier (par exemple `C:\Migration`).
2. **Ouvrir l'Exchange Management Shell** — pas une console PowerShell
   classique, avec un compte membre du rôle Organization Management.
3. **Vérifier l'espace disque et les journaux** — le script ne le fait pas
   pour vous :
   ```powershell
   Get-MailboxDatabase -Status | Format-Table Name, DatabaseSize, AvailableNewMailboxSpace
   ```
   Prévoyez au moins le double de la taille totale par base (données + copie
   en cours + journaux de transaction), et vérifiez que la croissance des
   journaux est activée.
4. **Tester avec `-WhatIf`** — affiche les commandes sans rien exécuter :
   ```powershell
   .\migration-batches.ps1 -WhatIf
   ```
5. **Lancer la création des batchs** :
   ```powershell
   .\migration-batches.ps1
   ```
   Chaque batch déplace ses boîtes vers sa base (`-TargetDatabases`).
   Sans `-AutoStart`, démarrez chaque batch à la main :
   ```powershell
   Start-MigrationBatch -Identity '<nom du batch>'
   ```
6. **Suivre la progression** :
   ```powershell
   Get-MigrationBatch | Format-Table Name, Status
   ```
7. **Finaliser si besoin** — sans `-AutoComplete`, le batch s'arrête une fois
   synchronisé et les boîtes ne sont pas déplacées :
   ```powershell
   Complete-MigrationBatch -Identity '<nom du batch>'
   ```
8. **Nettoyer** — quand les boîtes sont confirmées sur les nouvelles bases :
   ```powershell
   Remove-MigrationBatch -Identity '<nom du batch>'
   ```

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

## Accès

L'application est accessible sur : <https://exchange-dispatch.vercel.app/>

Aucune installation requise : ouvrez l'URL dans un navigateur et déposez
votre CSV. Tout se passe localement dans le navigateur, aucune donnée
n'est envoyée sur internet.

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
