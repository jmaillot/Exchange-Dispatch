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
  largeItemLimit: z.number().int().min(1, 'La limite d’éléments volumineux doit valoir au moins 1.'),
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
 * Commande `New-MigrationBatch` pour une base.
 *
 * `-CSVData` suffit : Exchange lit la colonne EmailAddress du fichier. Aucune
 * valeur issue du CSV n'est injectée dans la commande, et les valeurs
 * configurables passent toutes par `psSingleQuoted`.
 */
export function buildBatchCommand(params: BatchParams, csvFileName: string): string {
  const parts = [
    `New-MigrationBatch`,
    `  -Name ${psSingleQuoted(params.batchName)}`,
    `  -CSVData ${psSingleQuoted(csvFileName)}`,
    `  -BadItemLimit ${params.badItemLimit}`,
    `  -LargeItemLimit ${params.largeItemLimit}`,
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
    Exécutez ce script depuis la console Exchange Management Shell, sur un
    serveur Exchange Server on-premises, dans le dossier contenant les CSV.

    Le script ne valide PAS la place disponible sur les bases de destination :
    vérifiez vous-même l'espace disque et les journaux de transaction avant de
    lancer.

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
        `# --- ${assignment.name} : ${assignment.count} boîtes, ${formatNumber(assignment.totalMb)} Mo ---`,
        `if ($existing -contains ${psSingleQuoted(params.batchName)}) {`,
        `    Write-Warning ${psSingleQuoted(`Batch déjà présent : ${params.batchName}`)}`,
        `} elseif ($PSCmdlet.ShouldProcess(${psSingleQuoted(params.batchName)}, 'Créer le batch de migration')) {`,
        `    ${buildBatchCommand(params, fileName)}`,
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
      `${assignment.name} : ${assignment.count} boîte(s), ` +
        `${formatNumber(assignment.totalMb)} Mo, écart à la moyenne ${formatNumber(deviation)} Mo`,
    )
  }

  return lines.join('\n') + '\n'
}