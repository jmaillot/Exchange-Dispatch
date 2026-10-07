import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detectColumns,
  explainSizeFailure,
  formatSize,
  parseCsv,
  parseSizeMb,
  analyzeRows,
} from '@/lib/parse'

function fixture(name: string): string {
  return readFileSync(resolve(process.cwd(), 'tests/fixtures', name), 'utf8')
}

describe('parseSizeMb', () => {
  it('lit un décimal avec un point', () => {
    expect(parseSizeMb('1.52')).toBeCloseTo(1.52, 10)
    expect(parseSizeMb('1840.5')).toBeCloseTo(1840.5, 10)
    expect(parseSizeMb('0')).toBe(0)
  })

  it('tolère la virgule décimale', () => {
    expect(parseSizeMb('1,52')).toBeCloseTo(1.52, 10)
  })

  it('tolère les espaces et les espaces insécables', () => {
    expect(parseSizeMb(' 42.5 ')).toBeCloseTo(42.5, 10)
    expect(parseSizeMb('42.5 Mo')).toBeCloseTo(42.5, 10)
  })

  it('convertit les suffixes d’unité', () => {
    expect(parseSizeMb('512 B')).toBeCloseTo(512 / (1024 * 1024), 10)
    expect(parseSizeMb('2 GB')).toBeCloseTo(2048, 10)
    expect(parseSizeMb('1,5 Go')).toBeCloseTo(1536, 10)
  })

  it('traite une virgule unique comme décimale et plusieurs comme milliers', () => {
    expect(parseSizeMb('1,52')).toBeCloseTo(1.52, 10)
    expect(parseSizeMb('1,234,567')).toBe(1234567)
  })

  it('rejette vide, négatif et non numérique', () => {
    expect(parseSizeMb('')).toBeNull()
    expect(parseSizeMb('   ')).toBeNull()
    expect(parseSizeMb('abc')).toBeNull()
    expect(parseSizeMb('-50')).toBeNull()
    expect(parseSizeMb('12 EUR')).toBeNull()
    expect(parseSizeMb('1.2.3')).toBeNull()
  })

  it('donne un message d’erreur explicite', () => {
    expect(explainSizeFailure('')).toContain('vide')
    expect(explainSizeFailure('abc')).toContain('lisible')
    expect(explainSizeFailure('-50')).toContain('négative')
    expect(explainSizeFailure('12 EUR')).toContain('unité inconnue')
  })
})

describe('detectColumns', () => {
  it('détecte MailboxSizeMB et UserPrincipalName', () => {
    const result = parseCsv(fixture('mailboxes.csv'))
    expect(result.detectedSizeColumn).toBe('MailboxSizeMB')
    expect(result.detectedEmailColumn).toBe('UserPrincipalName')
  })

  it('ignore casse, espaces et underscores', () => {
    const result = parseCsv('mailbox size mb,user principal name\n1.5,a@b.fr')
    expect(result.detectedSizeColumn).toBe('mailbox size mb')
    expect(result.detectedEmailColumn).toBe('user principal name')
  })

  it('préfère EmailAddress à UserPrincipalName', () => {
    expect(detectColumns(['UserPrincipalName', 'EmailAddress'])).toEqual({
      sizeColumn: null,
      emailColumn: 'EmailAddress',
    })
  })

  it('retourne null quand rien ne ressemble', () => {
    expect(detectColumns(['aaa', 'bbb'])).toEqual({ sizeColumn: null, emailColumn: null })
  })
})

describe('parseCsv', () => {
  it('lit toutes les lignes valides de la fixture', () => {
    const result = parseCsv(fixture('mailboxes.csv'))
    expect(result.headers).toEqual([
      'DisplayName',
      'Alias',
      'SamAccountName',
      'UserPrincipalName',
      'FirstName',
      'LastName',
      'MailboxSizeMB',
    ])
    expect(result.rows).toHaveLength(10)
    expect(result.totalDataLines).toBe(10)
    expect(result.issues).toHaveLength(0)
    expect(result.invalidRows).toHaveLength(0)
  })

  it('conserve les colonnes d’origine', () => {
    const [first] = parseCsv(fixture('mailboxes.csv')).rows
    expect(first).toEqual({
      DisplayName: 'Dupont Alice',
      Alias: 'adupont',
      SamAccountName: 'a.dupont',
      UserPrincipalName: 'alice.dupont@exemple.fr',
      FirstName: 'Alice',
      LastName: 'Dupont',
      MailboxSizeMB: '1840.5',
    })
  })

  it('tolère des colonnes supplémentaires', () => {
    const result = parseCsv(
      'UserPrincipalName,MailboxSizeMB,Department\n' + 'a@b.fr,10,IT\n' + 'c@d.fr,20,Finance',
    )
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]?.Department).toBe('IT')
  })

  it('signale adresse vide, taille illisible et doublon', () => {
    const result = parseCsv(fixture('quality-issues.csv'))

    // 8 lignes de données, toutes conservées y compris la ligne vide : les
    // numéros de ligne rapportés doivent correspondre au tableur.
    expect(result.totalDataLines).toBe(8)
    expect(result.rows).toHaveLength(3)
    expect(result.rows.map((row) => row.UserPrincipalName)).toEqual([
      'alice.dupont@exemple.fr',
      'zero@exemple.fr',
      'bruno.martin@exemple.fr',
    ])

    const reasons = result.invalidRows.map((row) => row.reason).join(' | ')
    expect(reasons).toContain('adresse e-mail vide')
    expect(reasons).toContain('n’est pas un nombre lisible')
    expect(reasons).toContain('taille négative')
    expect(reasons).toContain('doublon d’adresse')

    expect(result.duplicateEmails).toEqual(['alice.dupont@exemple.fr'])
  })

  it('accepte une taille nulle', () => {
    const result = parseCsv(
      'UserPrincipalName,MailboxSizeMB\nzero@exemple.fr,0\ntexte@exemple.fr,abc',
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.MailboxSizeMB).toBe('0')
  })

  it('numérote les lignes comme un tableur (en-tête = 1)', () => {
    const result = parseCsv(fixture('quality-issues.csv'))
    // Ligne 3 sans adresse, 4 entièrement vide, 6 illisible, 7 négative,
    // 8 doublon. La ligne 5 (taille nulle) est valide.
    expect(result.invalidRows.map((row) => row.line)).toEqual([3, 4, 6, 7, 8])
  })

  it('respecte un mapping forcé', () => {
    const result = parseCsv(fixture('mailboxes.csv'), {
      sizeColumn: 'Alias',
      emailColumn: 'LastName',
    })
    expect(result.rows).toHaveLength(0)
    expect(result.issues.some((issue) => issue.column === 'Alias')).toBe(true)
  })

  it('signale l’absence de colonne de taille et d’adresse', () => {
    const result = parseCsv('aaa,bbb\n1,2')
    expect(result.issues.filter((issue) => issue.kind === 'structure')).toHaveLength(2)
  })

  it('ré-analyse sans relire le fichier quand le mapping change', () => {
    const initial = parseCsv(fixture('mailboxes.csv'))
    expect(initial.rows).toHaveLength(10)

    const remapped = analyzeRows(initial.headers, initial.rows, {
      sizeColumn: 'FirstName',
      emailColumn: 'UserPrincipalName',
    })
    expect(remapped.rows).toHaveLength(0)
  })
})

describe('formatSize', () => {
  it('affiche en Mo sous 1000', () => {
    expect(formatSize(42.5)).toBe('42,5 Mo')
    expect(formatSize(0)).toBe('0 Mo')
  })

  it('affiche en Go à partir de 1000', () => {
    expect(formatSize(1520)).toBe('1,5 Go')
    expect(formatSize(1000)).toBe('1 Go')
  })
})