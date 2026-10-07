import { describe, expect, it } from 'vitest'
import { balanceMailboxes, toMailboxes, type Mailbox } from '@/lib/balance'
import {
  EMAIL_COLUMN,
  SCRIPT_FILE_NAME,
  SERVER_STEPS,
  batchFileName,
  batchParamsSchema,
  buildBatchCommand,
  buildBatchCsv,
  buildScript,
  buildSummaryReport,
  buildTextExports,
  databaseNameSchema,
  preMigrationChecks,
  psSingleQuoted,
  type BatchParams,
} from '@/lib/exchange'
import { parseCsv } from '@/lib/parse'

const HEADERS = [
  'DisplayName',
  'Alias',
  'SamAccountName',
  'UserPrincipalName',
  'FirstName',
  'LastName',
  'MailboxSizeMB',
]

function csv(rows: ReadonlyArray<readonly [string, number]>): string {
  const header = 'DisplayName,Alias,SamAccountName,UserPrincipalName,FirstName,LastName,MailboxSizeMB'
  const body = rows
    .map(([email, size]) => `${email.split('@')[0]},a.${email.split('@')[0]},a.${email.split('@')[0]},${email},X,Y,${size}`)
    .join('\n')
  return `${header}\n${body}`
}

function summarize(rows: ReadonlyArray<readonly [string, number]>, names: string[]) {
  const parsed = parseCsv(csv(rows))
  const mailboxes = toMailboxes(parsed.rows, 'MailboxSizeMB', 'UserPrincipalName')
  return balanceMailboxes({ mailboxes, databaseNames: names })
}

const ROWS: ReadonlyArray<readonly [string, number]> = [
  ['alice@exemple.fr', 1840.5],
  ['bruno@exemple.fr', 1520],
  ['camille@exemple.fr', 990.25],
  ['chloe@exemple.fr', 760],
  ['hugo@exemple.fr', 610.75],
]

const DEFAULT_PARAMS: BatchParams = {
  batchName: 'MigrationDB01',
  autoStart: true,
  autoComplete: true,
  badItemLimit: 0,
  largeItemLimit: 100,
  notificationEmails: ['admin@exemple.fr'],
}

describe('psSingleQuoted', () => {
  it('échappe les apostrophes en les doublant', () => {
    expect(psSingleQuoted("O'Brien")).toBe("'O''Brien'")
    expect(psSingleQuoted('a')).toBe("'a'")
  })

  it('neutralise un nom commençant par un dollar', () => {
    // Le risque exact mentionné dans les règles : entre guillemets doubles,
    // $"user" serait interprété comme une variable.
    expect(psSingleQuoted('$user')).toBe("'$user'")
    expect(psSingleQuoted('$(Get-Process)')).toBe("'$(Get-Process)'")
  })
})

describe('buildBatchCsv', () => {
  it('met EmailAddress en premier puis toutes les colonnes d’origine', () => {
    const summary = summarize(ROWS, ['DB01'])
    const output = buildBatchCsv(summary.assignments[0]!, HEADERS)
    const lines = output.split('\r\n')

    expect(lines[0]).toBe(
      'EmailAddress,DisplayName,Alias,SamAccountName,UserPrincipalName,FirstName,LastName,MailboxSizeMB',
    )
    expect(lines).toHaveLength(ROWS.length + 1)
  })

  it('ne duplique pas EmailAddress si elle existe déjà', () => {
    const summary = summarize(ROWS, ['DB01'])
    const withEmail = [EMAIL_COLUMN, ...HEADERS]
    const output = buildBatchCsv(summary.assignments[0]!, withEmail)
    const header = output.split('\r\n')[0] ?? ''

    expect(header.match(/EmailAddress/g)).toHaveLength(1)
  })

  it('utilise l’adresse choisie pour EmailAddress', () => {
    const summary = summarize(ROWS, ['DB01'])
    const output = buildBatchCsv(summary.assignments[0]!, HEADERS)
    expect(output).toContain('alice@exemple.fr,alice')
  })

  it('échappe les cellules contenant une virgule ou un guillemet', () => {
    const mailbox: Mailbox = {
      index: 0,
      email: 'a@exemple.fr',
      sizeMb: 1,
      row: { DisplayName: 'Durand, Alice', Alias: 'say "hi"', MailboxSizeMB: '1' },
    }
    const output = buildBatchCsv(
      { name: 'DB01', mailboxes: [mailbox], totalMb: 1, count: 1 },
      ['DisplayName', 'Alias', 'MailboxSizeMB'],
    )

    expect(output).toContain('"Durand, Alice"')
    expect(output).toContain('"say ""hi"""')
  })
})

describe('buildBatchCommand', () => {
  it('reprend tous les paramètres configurables', () => {
    const command = buildBatchCommand(DEFAULT_PARAMS, 'DB01', 'batch.csv')

    expect(command).toContain(`-Name 'MigrationDB01'`)
    expect(command).toContain(`-TargetDatabases 'DB01'`)
    expect(command).toContain(`-BadItemLimit 0`)
    expect(command).toContain(`-LargeItemLimit 100`)
    expect(command).toContain(`-AutoStart`)
    expect(command).toContain(`-AutoComplete`)
    expect(command).toContain(`-NotificationEmails @('admin@exemple.fr')`)
  })

  it('lit le CSV en octets, pas comme un chemin', () => {
    // -CSVData attend un Byte[] : lui passer le nom du fichier enverrait
    // le nom lui-même comme données.
    const command = buildBatchCommand(DEFAULT_PARAMS, 'DB01', 'batch.csv')

    expect(command).toContain(`-CSVData ([System.IO.File]::ReadAllBytes('batch.csv'))`)
  })

  it('résout le chemin depuis le dossier du script dans le .ps1', () => {
    const command = buildBatchCommand(DEFAULT_PARAMS, 'DB01', 'batch.csv', true)

    expect(command).toContain(
      `-CSVData ([System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'batch.csv')))`,
    )
  })

  it('omet -AutoStart et -AutoComplete quand ils sont décochés', () => {
    const command = buildBatchCommand(
      { ...DEFAULT_PARAMS, autoStart: false, autoComplete: false },
      'DB01',
      'batch.csv',
    )

    expect(command).not.toContain('-AutoStart')
    expect(command).not.toContain('-AutoComplete')
  })

  it('omet -NotificationEmails si la liste est vide', () => {
    const command = buildBatchCommand(
      { ...DEFAULT_PARAMS, notificationEmails: [] },
      'DB01',
      'batch.csv',
    )
    expect(command).not.toContain('-NotificationEmails')
  })

  it('neutralise les valeurs qui casseraient une commande', () => {
    const command = buildBatchCommand(
      { ...DEFAULT_PARAMS, batchName: 'Batch " $-dangereux' },
      "DB01'; Remove-Mailbox -Identity x; '",
      "fichier'; Remove-Mailbox -Identity x; '.csv",
    )

    // Le guillemet double et le $ restent confinés dans des guillemets
    // simples : PowerShell ne les interprète pas.
    expect(command).toContain(`-Name 'Batch " $-dangereux'`)
    expect(command).toContain(`-TargetDatabases 'DB01''; Remove-Mailbox -Identity x; '''`)
    // Aucune valeur n'est placée hors guillemets simples, à l'exception
    // des expressions PowerShell que nous produisons nous-mêmes.
    const outsideQuotes = command
      .replace(/'[^']*'/g, '')
      .replace(/\(\[System\.IO\.File\]::ReadAllBytes\((.*?)\)\)/g, '')
    expect(outsideQuotes).not.toContain('"')
    expect(outsideQuotes).not.toContain('$PSScriptRoot')
  })
})

describe('batchParamsSchema', () => {
  it('refuse un badItemLimit négatif', () => {
    const result = batchParamsSchema.safeParse({ ...DEFAULT_PARAMS, badItemLimit: -1 })
    expect(result.success).toBe(false)
  })

  it('refuse un largeItemLimit nul', () => {
    const result = batchParamsSchema.safeParse({ ...DEFAULT_PARAMS, largeItemLimit: 0 })
    expect(result.success).toBe(false)
  })

  it('refuse une adresse de notification invalide', () => {
    const result = batchParamsSchema.safeParse({
      ...DEFAULT_PARAMS,
      notificationEmails: ['pas-une-adresse'],
    })
    expect(result.success).toBe(false)
  })

  it('refuse plus de 20 destinataires', () => {
    const emails = Array.from({ length: 21 }, (_, i) => `u${i}@exemple.fr`)
    const result = batchParamsSchema.safeParse({ ...DEFAULT_PARAMS, notificationEmails: emails })
    expect(result.success).toBe(false)
  })
})

describe('databaseNameSchema', () => {
  it('accepte un nom simple', () => {
    expect(databaseNameSchema.safeParse('DB01').success).toBe(true)
    expect(databaseNameSchema.safeParse('base-de-migration_2026.v1').success).toBe(true)
  })

  it('refuse vide, espace et caractère spécial', () => {
    expect(databaseNameSchema.safeParse('').success).toBe(false)
    expect(databaseNameSchema.safeParse('   ').success).toBe(false)
    expect(databaseNameSchema.safeParse('base 1').success).toBe(false)
    expect(databaseNameSchema.safeParse('base;1').success).toBe(false)
    expect(databaseNameSchema.safeParse('base$(x)').success).toBe(false)
    expect(databaseNameSchema.safeParse('a'.repeat(65)).success).toBe(false)
  })
})

describe('buildScript', () => {
  it('crée un New-MigrationBatch par base non vide', () => {
    const summary = summarize(ROWS, ['DB01', 'DB02', 'DB03'])
    const params = {
      DB01: { ...DEFAULT_PARAMS, batchName: 'B1' },
      DB02: { ...DEFAULT_PARAMS, batchName: 'B2' },
      DB03: { ...DEFAULT_PARAMS, batchName: 'B3' },
    }
    const script = buildScript(summary, params)

    expect(script).toContain('[CmdletBinding(SupportsShouldProcess = $true)]')
    expect(script.match(/New-MigrationBatch/g)).toHaveLength(3)
    expect(script).toContain(`-Name 'B1'`)
    expect(script).toContain(`-Name 'B3'`)
  })

  it('ne crée aucun batch pour une base vide', () => {
    // 3 boîtes pour 5 bases : les deux dernières restent vides.
    const summary = summarize(ROWS.slice(0, 3), ['DB01', 'DB02', 'DB03', 'DB04', 'DB05'])
    expect(summary.emptyDatabaseCount).toBe(2)

    const params = {
      DB01: { ...DEFAULT_PARAMS, batchName: 'B1' },
      DB02: { ...DEFAULT_PARAMS, batchName: 'B2' },
      DB03: { ...DEFAULT_PARAMS, batchName: 'B3' },
    }
    const script = buildScript(summary, params)

    expect(script).not.toContain(`-Name 'B4'`)
    expect(script).not.toContain(`-Name 'B5'`)
    expect(script).toContain('aucune boîte ne lui est affectée')
  })

  it('reprend un batch déjà créé plutôt que de le dupliquer', () => {
    const summary = summarize(ROWS, ['DB01'])
    const script = buildScript(summary, { DB01: { ...DEFAULT_PARAMS, batchName: 'B1' } })

    expect(script).toContain(`$existing -contains 'B1'`)
    expect(script).toContain('ShouldProcess')
  })

  it('cible la base de destination et lit le CSV depuis le dossier du script', () => {
    const summary = summarize(ROWS, ['DB01'])
    const script = buildScript(summary, { DB01: { ...DEFAULT_PARAMS, batchName: 'B1' } })

    expect(script).toContain(`-TargetDatabases 'DB01'`)
    expect(script).toContain(`Join-Path $PSScriptRoot 'batch-B1.csv'`)
  })

  it('embarque le mode d’emploi côté serveur', () => {
    const summary = summarize(ROWS, ['DB01'])
    const script = buildScript(summary, { DB01: { ...DEFAULT_PARAMS, batchName: 'B1' } })

    expect(script).toContain('Exchange Management Shell')
    expect(script).toContain('Complete-MigrationBatch')
    expect(script).toContain('Remove-MigrationBatch')
  })
})

describe('SERVER_STEPS', () => {
  it('couvre le parcours complet côté serveur', () => {
    const titles = SERVER_STEPS.map((step) => step.title).join(' | ')

    expect(titles).toContain('Exchange Management Shell')
    expect(titles).toContain('WhatIf')
    expect(titles).toContain('AutoComplete')
  })
})

describe('preMigrationChecks', () => {
  it('signale l’espace disque et les journaux de transaction', () => {
    const summary = summarize(ROWS, ['DB01'])
    const checks = preMigrationChecks(summary.assignments, {
      DB01: DEFAULT_PARAMS,
    })
    const titles = checks.map((check) => check.title)

    expect(titles).toContain('Espace disque sur les bases de destination')
    expect(titles).toContain('Journaux de transaction')
  })

  it('rappelle Complete-MigrationBatch quand AutoComplete est décoché', () => {
    const summary = summarize(ROWS, ['DB01', 'DB02'])
    const checks = preMigrationChecks(summary.assignments, {
      DB01: { ...DEFAULT_PARAMS, batchName: 'B1' },
      DB02: { ...DEFAULT_PARAMS, batchName: 'B2', autoComplete: false },
    })

    const warning = checks.find((check) => check.title === 'Batchs sans -AutoComplete')
    expect(warning).toBeDefined()
    expect(warning?.detail).toContain('DB02')
    expect(warning?.detail).toContain('Complete-MigrationBatch')
  })

  it('ne se plaint pas quand tous les batchs ont AutoComplete', () => {
    const summary = summarize(ROWS, ['DB01', 'DB02'])
    const checks = preMigrationChecks(summary.assignments, {
      DB01: { ...DEFAULT_PARAMS, batchName: 'B1' },
      DB02: { ...DEFAULT_PARAMS, batchName: 'B2' },
    })

    expect(checks.map((check) => check.title)).not.toContain('Batchs sans -AutoComplete')
  })
})

describe('buildTextExports', () => {
  it('inclut le script, le récapitulatif et un CSV par base non vide', () => {
    const summary = summarize(ROWS.slice(0, 3), ['DB01', 'DB02', 'DB03', 'DB04', 'DB05'])
    const files = buildTextExports(
      summary,
      {
        DB01: { ...DEFAULT_PARAMS, batchName: 'B1' },
        DB02: { ...DEFAULT_PARAMS, batchName: 'B2' },
        DB03: { ...DEFAULT_PARAMS, batchName: 'B3' },
      },
      HEADERS,
    )

    const names = files.map((file) => file.fileName)
    expect(names).toContain(SCRIPT_FILE_NAME)
    expect(names).toContain('repartition.txt')
    expect(names).toContain('batch-B1.csv')
    expect(names).not.toContain('batch-B4.csv')
  })

  it('rend le script exécutable et déterministe', () => {
    const summary = summarize(ROWS, ['DB01', 'DB02'])
    const params = {
      DB01: { ...DEFAULT_PARAMS, batchName: 'B1' },
      DB02: { ...DEFAULT_PARAMS, batchName: 'B2' },
    }

    expect(buildScript(summary, params)).toBe(buildScript(summary, params))
    expect(buildSummaryReport(summary)).toBe(buildSummaryReport(summary))
  })

  it('résume les tailles dans le rapport', () => {
    const summary = summarize(ROWS, ['DB01', 'DB02'])
    const report = buildSummaryReport(summary)

    expect(report).toContain('Total :')
    expect(report).toContain('Écart max-min')
    expect(report).toContain('DB01')
  })
})

describe('batchFileName', () => {
  it('rend un nom de fichier sûr', () => {
    expect(batchFileName('Migration DB01')).toBe('batch-Migration-DB01.csv')
    expect(batchFileName('a/b\\c:d')).toBe('batch-a-b-c-d.csv')
  })
})