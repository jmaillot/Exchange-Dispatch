import { z } from 'zod'
import type { BalanceSummary, DatabaseAssignment, Mailbox } from './balance'
import { formatNumber } from './parse'

/**
 * Génération des livrables de migration Exchange : un CSV par base, les
 * commandes `New-MigrationBatch` et un script PowerShell complet.
 *
 * Règle de sécurité non négociable : aucune valeur issue du CSV n'est
 * jamais placée dans une chaîne entre guillemets doubles. Un
 * SamAccountName commence souvent par `$`, que PowerShell interpréterait
 * comme le début d'une variable. Tout passe par des guillemets simples,
 * apostrophes doublées.
 */

/** Colonne obligatoire pour `New-MigrationBatch -CSVData`. */
export const EMAIL_COLUMN = 'EmailAddress'

/** Plafond Exchange sur les destinataires de notification d'un batch. */
const MAX_NOTIFICATION_EMAILS = 20

/** Un nom de base Exchange : lettres, chiffres, point, tiret, 1 à 64 caractères. */
export const databaseNameSchema = z
  .string()
  .trim()
  .min(1, 'Le nom de base est obligatoire.')
  .max(64, 'Le nom de base est limité à 64 caractères.')
  .regex(
    /^[A-Za-z0-9._-]+$/,
    'Caractères autorisés uniquement : lettres, chiffres, point, tiret et tiret bas.',
  )

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'adresse e-mail invalide')

/** Paramètres d'un batch de migration, tous éditables par l'utilisateur. */
export const batchParamsSchema = z.object({
  /** Nom du batch tel qu'il apparaîtra dans `Get-MigrationBatch`. */
  batchName: z
    .string()
    .trim()
    .min(1, 'Le nom de batch est obligatoire.')
    .max(100, 'Le nom de batch est limité à 100 caractères.'),
  autoStart: z.boolean(),
  autoComplete: z.boolean(),
  badItemLimit: z.number().int().min(0, 'La limite d’éléments invalides ne peut pas être négative.'),
  // Pas de LargeItemLimit : ce paramètre n'existe pas dans le jeu « Local »
  // de New-MigrationBatch (émettre -LargeItemLimit ferait échouer la
  // commande). La limite des éléments volumineux reste celle du service MRS.
  notificationEmails: z.array(emailSchema).max(
    MAX_NOTIFICATION_EMAILS,
    `Exchange accepte au maximum ${MAX_NOTIFICATION_EMAILS} destinataires par batch.`,
  ),
})

export type BatchParams = z.infer<typeof batchParamsSchema>

/** Nom de base -> paramètres du batch associé. */
export type BatchParamsByDatabase = Record<string, BatchParams>

/**
 * Échappe une valeur pour une chaîne PowerShell à guillemets simples :
 * on double l'apostrophe. `O'Brien` devient `O''Brien`.
 */
export function psSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Échappe une valeur destinée à un littéral CSV : si la cellule contient une
 * virgule, un guillemet ou un retour à la ligne, elle doit être entourée de
 * guillemets, les guillemets internes doublés.
 */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * CSV d'un batch : colonne EmailAddress en premier, puis toutes les
 * colonnes d'origine dans leur ordre initial. Aucune colonne n'est dupliquée.
 */
export function buildBatchCsv(assignment: DatabaseAssignment, headers: readonly string[]): string {
  const columns = [EMAIL_COLUMN, ...headers.filter((header) => header !== EMAIL_COLUMN)]

  const lines = [columns.map(csvCell).join(',')]

  for (const mailbox of assignment.mailboxes) {
    lines.push(columns.map((column) => csvCell(columnValue(mailbox, column))).join(','))
  }

  return lines.join('\r\n')
}

/** Valeur d'une colonne pour une boîte donnée. */
function columnValue(mailbox: Mailbox, column: string): string {
  if (column === EMAIL_COLUMN) {
    return mailbox.email
  }
  return mailbox.row[column] ?? ''
}

/**
 * Expression PowerShell qui lit un CSV en octets pour `-CSVData`.
 *
 * `-CSVData` attend un tableau d'octets, pas un chemin : lui passer le nom
 * du fichier enverrait le nom lui-même comme données. Dans le script, le
 * chemin est résolu depuis son propre dossier ; en commande isolée, depuis
 * le dossier courant — d'où la consigne de se placer dans le dossier des
 * CSV avant de coller la commande.
 */
export function csvDataExpression(csvFileName: string, inScript: boolean): string {
  const quoted = psSingleQuoted(csvFileName)
  const path = inScript ? `(Join-Path $PSScriptRoot ${quoted})` : quoted
  return `([System.IO.File]::ReadAllBytes(${path}))`
}

/**
 * Commande `New-MigrationBatch` pour une base.
 *
 * `-TargetDatabases` est obligatoire : sans lui, Exchange ne sait pas vers
 * quelle base déplacer les boîtes. Aucune valeur issue du CSV n'est injectée
 * dans la commande ; les valeurs configurables passent par `psSingleQuoted`.
 */
export function buildBatchCommand(
  params: BatchParams,
  targetDatabase: string,
  csvFileName: string,
  inScript = false,
): string {
  // Conforme à l'exemple 1 de la doc (déplacement local) : -Local est
  // obligatoire pour un déplacement on-premises, et -AllowUnknownColumnsInCsv
  // parce que nos CSV conservent les colonnes d'origine en plus d'EmailAddress.
  const parts = [
    `New-MigrationBatch -Local`,
    `  -Name ${psSingleQuoted(params.batchName)}`,
    `  -CSVData ${csvDataExpression(csvFileName, inScript)}`,
    `  -TargetDatabases ${psSingleQuoted(targetDatabase)}`,
    `  -AllowUnknownColumnsInCsv:$true`,
    `  -BadItemLimit ${params.badItemLimit}`,
  ]

  if (params.autoStart) {
    parts.push(`  -AutoStart`)
  }

  if (params.autoComplete) {
    parts.push(`  -AutoComplete`)
  }

  if (params.notificationEmails.length > 0) {
    const list = params.notificationEmails.map(psSingleQuoted).join(', ')
    parts.push(`  -NotificationEmails @(${list})`)
  }

  return parts.join(' `\n')
}

/** Nom de fichier du CSV d'un batch. */
export function batchFileName(batchName: string): string {
  return `batch-${sanitizeFileToken(batchName)}.csv`
}

/** Nom de fichier du script PowerShell complet. */
export const SCRIPT_FILE_NAME = 'migration-batches.ps1'

/** Rend un jeton sûr pour un nom de fichier Windows. */
function sanitizeFileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'batch'
}

/** En-tête du script PowerShell généré. */
const SCRIPT_HEADER = `<#
.SYNOPSIS
    Création des batchs de migration Exchange à partir des fichiers CSV générés
    par Exchange DB Balancer.

.DESCRIPTION
    1. Copiez ce script ET les fichiers batch-*.csv dans un même dossier sur
       un serveur Exchange Server on-premises.
    2. Ouvrez l'Exchange Management Shell (pas une console PowerShell
       classique) avec un compte membre de Organization Management.
    3. Vérifiez l'espace disque des volumes cibles et les journaux de
       transaction AVANT de lancer (le script ne le fait pas pour vous).
    4. Testez d'abord avec -WhatIf : .\\migration-batches.ps1 -WhatIf
    5. Lancez pour de bon : .\\migration-batches.ps1
    6. Suivez la progression : Get-MigrationBatch | Format-Table Name, Status
    7. Sans -AutoComplete : finalisez chaque batch terminé avec
       Complete-MigrationBatch -Identity '<nom du batch>'.
    8. Une fois les boîtes vérifiées sur les nouvelles bases, nettoyez avec
       Remove-MigrationBatch -Identity '<nom du batch>'.

.PARAMETER WhatIf
    N'exécute rien, affiche seulement les commandes qui seraient lancées.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'

# Un batch déjà créé est réutilisé plutôt que dupliqué.
$existing = (Get-MigrationBatch).Name
`

/**
 * Script PowerShell complet : un `New-MigrationBatch` par base non vide.
 * Les bases vides sont signalées en commentaire, sans commande — un batch
 * sans destinataire échouerait sur le serveur.
 */
export function buildScript(
  summary: BalanceSummary,
  paramsByDatabase: BatchParamsByDatabase,
): string {
  const sections: string[] = [SCRIPT_HEADER]

  for (const assignment of summary.assignments) {
    if (assignment.count === 0) {
      sections.push(
        `# Base ${assignment.name} : aucune boîte ne lui est affectée, aucun batch créé.`,
      )
      continue
    }

    const params = paramsByDatabase[assignment.name]
    if (params === undefined) {
      sections.push(
        `# Base ${assignment.name} : paramètres de batch manquants, batch ignoré.`,
      )
      continue
    }

    const fileName = batchFileName(params.batchName)
    sections.push(
      [
        `# --- ${assignment.name} : ${assignment.count} boîte${assignment.count > 1 ? 's' : ''}, ${formatNumber(assignment.totalMb)} Mo ---`,
        `if ($existing -contains ${psSingleQuoted(params.batchName)}) {`,
        `    Write-Warning ${psSingleQuoted(`Batch déjà présent : ${params.batchName}`)}`,
        `} elseif ($PSCmdlet.ShouldProcess(${psSingleQuoted(params.batchName)}, 'Créer le batch de migration')) {`,
        `    ${buildBatchCommand(params, assignment.name, fileName, true)}`,
        `}`,
      ].join('\r\n'),
    )
  }

  sections.push(
    [
      `Write-Host ''`,
      `Get-MigrationBatch | Select-Object Name, Status, RecipientCount | Format-Table -AutoSize`,
    ].join('\r\n'),
  )

  return sections.join('\r\n\r\n') + '\r\n'
}

export type PreMigrationCheck = {
  level: 'info' | 'warning' | 'danger'
  title: string
  detail: string
}

/** Une étape à effectuer sur le serveur Exchange, affichée dans l'export. */
export type ServerStep = {
  title: string
  detail: string
  /** Commande à copier, le cas échéant. */
  command?: string
}

/**
 * Marche à suivre côté serveur Exchange, dans l'ordre.
 *
 * C'est la même liste que l'en-tête du script .ps1, sous forme structurée
 * pour l'affichage. Toute modification ici doit être répercutée dans
 * SCRIPT_HEADER (le script embarque sa propre copie pour rester autonome).
 */
export const SERVER_STEPS: readonly ServerStep[] = [
  {
    title: 'Copier les fichiers sur le serveur',
    detail:
      'Déposez le script .ps1 et tous les fichiers batch-*.csv du ZIP dans un même dossier ' +
      'sur un serveur Exchange Server on-premises (par exemple C:\\Migration).',
  },
  {
    title: 'Ouvrir l’Exchange Management Shell',
    detail:
      'Utilisez l’Exchange Management Shell, pas une console PowerShell classique, avec un ' +
      'compte membre du rôle Organization Management.',
  },
  {
    title: 'Vérifier l’espace disque et les journaux',
    detail:
      'Contrôlez la place restante sur les volumes des bases de destination et la croissance ' +
      'des journaux de transaction. Le script ne le fait pas pour vous.',
    command: 'Get-MailboxDatabase -Status | Format-Table Name, DatabaseSize, AvailableNewMailboxSpace',
  },
  {
    title: 'Tester avec -WhatIf',
    detail: 'Affiche les commandes qui seraient lancées, sans rien exécuter.',
    command: '.\\migration-batches.ps1 -WhatIf',
  },
  {
    title: 'Lancer la création des batchs',
    detail: 'Crée un New-MigrationBatch -Local par base non vide, vers sa base cible.',
    command: '.\\migration-batches.ps1',
  },
  {
    title: 'Démarrer si besoin (sans -AutoStart)',
    detail:
      'Sans -AutoStart, le batch reste en attente après sa création : démarrez-le ' +
      'explicitement, comme dans l’exemple 1 de la documentation.',
    command: "Start-MigrationBatch -Identity '<nom du batch>'",
  },
  {
    title: 'Suivre la progression',
    detail: 'Un batch passe par les statuts Validating, Queued, InProgress puis Synced.',
    command: 'Get-MigrationBatch | Format-Table Name, Status',
  },
  {
    title: 'Finaliser si besoin (sans -AutoComplete)',
    detail:
      'Sans -AutoComplete, le batch s’arrête une fois synchronisé : les boîtes ne sont pas ' +
      'déplacées tant que vous ne l’avez pas finalisé.',
    command: "Complete-MigrationBatch -Identity '<nom du batch>'",
  },
  {
    title: 'Nettoyer une fois vérifié',
    detail:
      'Quand les boîtes sont confirmées sur les nouvelles bases, supprimez les batchs terminés.',
    command: "Remove-MigrationBatch -Identity '<nom du batch>'",
  },
]

/**
 * Vérifications à faire avant de lancer la migration.
 *
 * Rien ici n'est mesurable depuis un navigateur : ce sont des rappels, pas
 * des contrôles. `-AutoComplete` est le seul point où l'outil a vraiment
 * une information à fournir — il sait si le batch sera finalisé tout seul.
 */
export function preMigrationChecks(
  assignments: readonly DatabaseAssignment[],
  paramsByDatabase: BatchParamsByDatabase,
): PreMigrationCheck[] {
  const checks: PreMigrationCheck[] = []
  const nonEmpty = assignments.filter((assignment) => assignment.count > 0)

  checks.push({
    level: 'danger',
    title: 'Espace disque sur les bases de destination',
    detail:
      'Le répartiteur ne connaît que la taille des boîtes, pas la place ' +
      'restante. Une migration a besoin de la taille des données PLUS la ' +
      'copie en cours de déplacement PLUS la croissance et les fichiers ' +
      'journaux de transaction. Prévoyez au moins le double de la taille ' +
      'totale par base, et vérifiez `Get-PSDrive` avant de lancer.',
  })

  checks.push({
    level: 'warning',
    title: 'Journaux de transaction',
    detail:
      'Les journaux de transaction de la base de destination doivent avoir ' +
      'croissance activée et des fichiers suffisamment dimensionnés. Une ' +
      'base en mode « Circuler » bloque la migration dès qu\'il est plein.',
  })

  const withoutAutoComplete = nonEmpty.filter((assignment) => {
    const params = paramsByDatabase[assignment.name]
    return params !== undefined && !params.autoComplete
  })

  if (withoutAutoComplete.length > 0) {
    const names = withoutAutoComplete.map((assignment) => assignment.name).join(', ')
    checks.push({
      level: 'warning',
      title: 'Batchs sans -AutoComplete',
      detail:
        `${names} : sans -AutoComplete, le batch s'arrête en état ` +
        '« Completed » mais n\'est pas finalisé. Vous devrez lancer ' +
        '`Complete-MigrationBatch` sur chacun, ou le laisser en attente : ' +
        'les boîtes ne sont pas encore déplacées tant que ce n\'est pas fait.',
    })
  }

  checks.push({
    level: 'info',
    title: 'Créneau de maintenance',
    detail:
      'La migration déplace des données en production. Prévoyez une ' +
      'maintenance, et vérifiez que la réplication passive est à jour avant ' +
      'de basculer le flux.',
  })

  return checks
}

export type ExportBundle = {
  fileName: string
  content: string
}

/**
 * Fichiers texte à inclure dans le ZIP : les CSV par base, le script
 * PowerShell et le récapitulatif. Les bases vides n'y figurent pas.
 */
export function buildTextExports(
  summary: BalanceSummary,
  paramsByDatabase: BatchParamsByDatabase,
  headers: readonly string[],
): ExportBundle[] {
  const bundles: ExportBundle[] = [
    { fileName: SCRIPT_FILE_NAME, content: buildScript(summary, paramsByDatabase) },
    { fileName: 'repartition.txt', content: buildSummaryReport(summary) },
  ]

  for (const assignment of summary.assignments) {
    if (assignment.count === 0) {
      continue
    }
    const params = paramsByDatabase[assignment.name]
    if (params === undefined) {
      continue
    }
    bundles.push({
      fileName: batchFileName(params.batchName),
      content: buildBatchCsv(assignment, headers),
    })
  }

  return bundles
}

/** Contenu du fichier de récapitulatif, en clair, pour comparaison manuelle. */
export function buildSummaryReport(summary: BalanceSummary): string {
  const lines = [
    'Récapitulatif de la répartition',
    '===============================',
    '',
    `Total : ${formatNumber(summary.totalMb)} Mo sur ${summary.assignments.length} base(s)`,
    `Moyenne par base : ${formatNumber(summary.averageMb)} Mo`,
    `Écart max-min : ${formatNumber(summary.spreadMb)} Mo`,
    '',
  ]

  for (const assignment of summary.assignments) {
    const deviation = Math.abs(assignment.totalMb - summary.averageMb)
    lines.push(
      `${assignment.name} : ${assignment.count} boîte${assignment.count > 1 ? 's' : ''}, ` +
        `${formatNumber(assignment.totalMb)} Mo, écart à la moyenne ${formatNumber(deviation)} Mo`,
    )
  }

  return lines.join('\n') + '\n'
}