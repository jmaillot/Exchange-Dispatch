import Papa from 'papaparse'
import { z } from 'zod'

/**
 * Tailles : nombres décimaux en mégaoctets (MB).
 *
 * L'export Exchange produit typiquement `1.52` (point décimal). La virgule
 * décimale (`1,52`) est tolérée par cohérence avec les affichages
 * Exchange en clair (`1,23 GB (1 234 000 000 bytes)`), mais le point reste
 * la référence.
 *
 * Les suffixes d'unité (B, KB, MB, GB, TB) sont acceptés au cas où,
 * mais aucun n'est nécessaire : une valeur nue vaut des mégaoctets.
 */
const SUFFIX_FACTORS: ReadonlyMap<string, number> = new Map([
  ['b', 1 / (1024 * 1024)],
  ['octet', 1 / (1024 * 1024)],
  ['octets', 1 / (1024 * 1024)],
  ['kb', 1 / 1024],
  ['ko', 1 / 1024],
  ['mb', 1],
  ['mo', 1],
  ['gb', 1024],
  ['go', 1024],
  ['tb', 1024 * 1024],
  ['to', 1024 * 1024],
])

/** Colonnes reconnues comme taille, par ordre de priorité (casse/espaces insensibles). */
const SIZE_HINTS = ['mailboxsizemb', 'mailboxsize', 'sizemb', 'size', 'taille', 'taillemb'] as const

/** Colonnes reconnues comme adresse, par ordre de priorité. */
const EMAIL_HINTS = [
  'emailaddress',
  'userprincipalname',
  'primarysmtpaddress',
  'smtpaddress',
  'upn',
  'email',
  'mail',
] as const

/**
 * Chaîne -> mégaoctets. Échoue avec un message lisible si la valeur est
 * vide, négative ou non numérique.
 */
const sizeSchema = z
  .string()
  .trim()
  .min(1, 'valeur vide')
  .transform((value, ctx) => {
    const normalized = value.replace(/[\s\u00a0]/g, '')

    // Mantisse, puis suffixe d'unité facultatif. On autorise plusieurs
    // séparateurs dans la mantisse (« 1,234,567 ») ; c'est
    // `Number()` plus les règles ci-dessous qui décident de leur sens.
    const match = /^([+-]?\d[\d.,]*)([a-zA-Zéèêàùôç]*)$/.exec(normalized)

    if (match === null) {
      ctx.addIssue({ code: 'custom', message: `« ${value} » n’est pas un nombre lisible` })
      return z.NEVER
    }

    const [, digits = '', suffix = ''] = match
    const unit = suffix.toLowerCase()

    if (unit !== '' && !SUFFIX_FACTORS.has(unit)) {
      ctx.addIssue({
        code: 'custom',
        message: `unité inconnue « ${suffix} » dans « ${value} »`,
      })
      return z.NEVER
    }

    const sign = digits.startsWith('-') ? -1 : 1
    const unsigned = digits.replace(/^[+-]/, '')

    const dots = (unsigned.match(/\./g) ?? []).length
    const commas = (unsigned.match(/,/g) ?? []).length
    const separators = dots + commas

    let magnitude: string

    if (separators === 0) {
      magnitude = unsigned
    } else if (separators === 1) {
      // Un seul séparateur : c'est le séparateur décimal.
      const decimalAt = Math.max(unsigned.lastIndexOf('.'), unsigned.lastIndexOf(','))
      const decimals = unsigned.slice(decimalAt + 1)
      const integers = unsigned.slice(0, decimalAt)
      if (!/^\d+$/.test(decimals) || !/^\d*$/.test(integers)) {
        ctx.addIssue({ code: 'custom', message: `« ${value} » n’est pas un nombre lisible` })
        return z.NEVER
      }
      magnitude = integers === '' ? `0.${decimals}` : `${integers}.${decimals}`
    } else {
      // Plusieurs séparateurs. Deux styles mélangés = format Exchange
      // « 1.234,5 » : le dernier séparateur est décimal. Sinon tous sont
      // des milliers, ce qui impose des groupes de 3 chiffres.
      //   « 1,234,567 » -> 1234567   (virgules multiples)
      //   « 1.234.567 » -> 1234567   (points multiples)
      //   « 1.234,5 »   -> 1234,5    (styles mélangés)
      const mixed = dots > 0 && commas > 0
      if (mixed) {
        const decimalAt = Math.max(unsigned.lastIndexOf('.'), unsigned.lastIndexOf(','))
        const decimals = unsigned.slice(decimalAt + 1)
        const integers = unsigned.slice(0, decimalAt).replace(/[.,]/g, '')
        if (!/^\d+$/.test(decimals) || !/^\d*$/.test(integers)) {
          ctx.addIssue({ code: 'custom', message: `« ${value} » n’est pas un nombre lisible` })
          return z.NEVER
        }
        magnitude = integers === '' ? `0.${decimals}` : `${integers}.${decimals}`
      } else {
        const separator = dots > 0 ? '.' : ','
        const [head = '', ...groups] = unsigned.split(separator)
        const wellFormed =
          /^\d{1,3}$/.test(head) && groups.every((group) => /^\d{3}$/.test(group))
        if (!wellFormed) {
          ctx.addIssue({ code: 'custom', message: `« ${value} » n’est pas un nombre lisible` })
          return z.NEVER
        }
        magnitude = unsigned.replace(/[.,]/g, '')
      }
    }

    if (!/^\d+(\.\d+)?$/.test(magnitude)) {
      ctx.addIssue({ code: 'custom', message: `« ${value} » n’est pas un nombre lisible` })
      return z.NEVER
    }

    const numeric = sign * Number(magnitude)

    if (!Number.isFinite(numeric)) {
      ctx.addIssue({ code: 'custom', message: `« ${value} » n’est pas un nombre` })
      return z.NEVER
    }

    if (numeric < 0) {
      ctx.addIssue({ code: 'custom', message: `taille négative (${value})` })
      return z.NEVER
    }

    const factor = unit === '' ? 1 : (SUFFIX_FACTORS.get(unit) ?? 1)
    return numeric * factor
  })

/** Une ligne CSV : en-tête -> valeur brute, tel que lu. */
export const rawRowSchema = z.record(z.string(), z.string())
export type RawRow = z.infer<typeof rawRowSchema>

export type Mapping = {
  sizeColumn: string | null
  emailColumn: string | null
}

/** Anomalie constatée à l'import, à afficher telle quelle. */
export type ParseIssue = {
  /** Ligne telle que vue dans un tableur : 1 = en-tête, 2 = première donnée. */
  line: number
  column: string | null
  message: string
  kind: 'size' | 'email' | 'duplicate' | 'structure'
}

/** Ligne écartée de la répartition, avec le motif. */
export type InvalidRow = {
  line: number
  row: RawRow
  reason: string
  column: string | null
}

export type ParseResult = {
  headers: string[]
  /** Lignes exploitables, dans l'ordre du fichier. */
  rows: RawRow[]
  invalidRows: InvalidRow[]
  issues: ParseIssue[]
  duplicateEmails: string[]
  detectedSizeColumn: string | null
  detectedEmailColumn: string | null
  totalDataLines: number
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function detectColumn(headers: readonly string[], hints: readonly string[]): string | null {
  const byNormalized = new Map<string, string>()
  for (const header of headers) {
    const key = normalizeHeader(header)
    if (!byNormalized.has(key)) {
      byNormalized.set(key, header)
    }
  }

  for (const hint of hints) {
    const found = byNormalized.get(hint)
    if (found !== undefined) {
      return found
    }
  }

  return null
}

/**
 * Devine la colonne de taille et la colonne d'adresse.
 *
 * Si une seule colonne correspond aux deuxfamilles de noms, elle ne peut
 * pas jouer les deux rôles : on ne la propose pas comme adresse.
 */
export function detectColumns(headers: readonly string[]): Mapping {
  const sizeColumn = detectColumn(headers, SIZE_HINTS)
  const emailColumn = detectColumn(headers, EMAIL_HINTS)
  return { sizeColumn, emailColumn }
}

/** Taille en mégaoctets, ou `null` si la valeur n'est pas exploitable. */
export function parseSizeMb(value: string): number | null {
  const parsed = sizeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Message d'erreur lisible pour une taille non exploitable. */
export function explainSizeFailure(value: string): string {
  const parsed = sizeSchema.safeParse(value)
  if (parsed.success) {
    return ''
  }
  return parsed.error.issues[0]?.message ?? `taille illisible : « ${value} »`
}

/** Taille lisible : « 1,2 Go » / « 850 Mo ». Unités décimales (1 Go = 1000 Mo). */
export function formatSize(sizeMb: number): string {
  if (!Number.isFinite(sizeMb)) {
    return '—'
  }
  if (sizeMb === 0) {
    return '0 Mo'
  }
  if (Math.abs(sizeMb) >= 1000) {
    const gb = sizeMb / 1000
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(gb)} Go`
  }
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(sizeMb)} Mo`
}

/** Nombre avec séparateurs de milliers français. */
export function formatNumber(value: number, fractionDigits = 1): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: fractionDigits }).format(value)
}

function toRawRows(data: Record<string, unknown>[]): RawRow[] {
  return data.map((entry) => {
    const row: RawRow = {}
    for (const [key, value] of Object.entries(entry)) {
      row[key] = value === null || value === undefined ? '' : String(value)
    }
    return row
  })
}

/**
 * Analyse des en-têtes et des lignes déjà découpées, avec contrôle qualité
 * pour le mapping donné. Utilisé directement quand l'utilisateur change le
 * mapping sans reparser le fichier.
 */
export function analyzeRows(
  headers: string[],
  rows: RawRow[],
  mapping: Mapping,
  totalDataLines = rows.length,
): ParseResult {
  const valid: RawRow[] = []
  const invalidRows: InvalidRow[] = []
  const issues: ParseIssue[] = []
  const duplicateEmails: string[] = []

  const { sizeColumn, emailColumn } = mapping

  if (sizeColumn === null) {
    issues.push({
      line: 1,
      column: null,
      kind: 'structure',
      message: 'Aucune colonne de taille sélectionnée. Choisissez-la au mapping.',
    })
  }
  if (emailColumn === null) {
    issues.push({
      line: 1,
      column: null,
      kind: 'structure',
      message: 'Aucune colonne d’adresse sélectionnée. Choisissez-la au mapping.',
    })
  }

  const firstSeenLine = new Map<string, number>()

  rows.forEach((row, index) => {
    const line = index + 2

    if (sizeColumn !== null) {
      const rawSize = row[sizeColumn] ?? ''
      if (parseSizeMb(rawSize) === null) {
        const reason = explainSizeFailure(rawSize)
        invalidRows.push({ line, row, reason, column: sizeColumn })
        issues.push({ line, column: sizeColumn, kind: 'size', message: reason })
        return
      }
    }

    if (emailColumn !== null) {
      const email = (row[emailColumn] ?? '').trim()
      if (email === '') {
        invalidRows.push({ line, row, reason: 'adresse e-mail vide', column: emailColumn })
        issues.push({
          line,
          column: emailColumn,
          kind: 'email',
          message: 'adresse e-mail vide',
        })
        return
      }

      const seenAt = firstSeenLine.get(email)
      if (seenAt === undefined) {
        firstSeenLine.set(email, line)
      } else {
        if (!duplicateEmails.includes(email)) {
          duplicateEmails.push(email)
        }
        invalidRows.push({
          line,
          row,
          reason: `doublon d’adresse « ${email} » (déjà présente ligne ${seenAt})`,
          column: emailColumn,
        })
        issues.push({
          line,
          column: emailColumn,
          kind: 'duplicate',
          message: `doublon d’adresse « ${email} », déjà présente ligne ${seenAt}`,
        })
        return
      }
    }

    valid.push(row)
  })

  return {
    headers,
    rows: valid,
    invalidRows,
    issues,
    duplicateEmails,
    detectedSizeColumn: detectColumns(headers).sizeColumn,
    detectedEmailColumn: detectColumns(headers).emailColumn,
    totalDataLines,
  }
}

/**
 * Lit un CSV (séparateur virgule, en-têtes) et renvoie les lignes valides
 * plus le rapport de contrôle qualité.
 *
 * Le mapping par défaut est celui détecté automatiquement ; l'utilisateur
 * peut ensuite le changer et rappeler `analyzeRows` sans relire le fichier.
 */
export function parseCsv(csv: string, mapping?: Mapping): ParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    // On ne saute pas les lignes vides : elles font partie du diagnostic.
    // Comme elles sont comptées à leur place, les numéros de ligne rapportés
    // correspondent toujours à ce que voit l'utilisateur dans son tableur.
    skipEmptyLines: false,
    transformHeader: (header) => header.trim(),
  })

  const headers = (parsed.meta.fields ?? []).filter((field) => field !== undefined && field !== '')

  // Les erreurs de PapaParse (nombre de champs irrégulier, guillemets
  // mal fermés) n'affectent que la ligne concernée : `analyzeRows` écarte
  // la ligne si la colonne manquante est requise par le mapping.
  const rows = toRawRows(parsed.data)
  const effectiveMapping = mapping ?? detectColumns(headers)

  return analyzeRows(headers, rows, effectiveMapping, rows.length)
}