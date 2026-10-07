'use client'

import { analyzeRows, formatSize, parseCsv, parseSizeMb } from '@/lib/parse'
import type { Mapping } from '@/lib/wizard'
import { Card, Field, Notice, selectClass } from './ui'

/**
 * Étape 2 : confirmation des colonnes taille et adresse.
 *
 * Changer une colonne relance l'analyse sur les lignes déjà lues — le
 * fichier n'est pas relu, et le nombre de lignes exploitables se met à jour
 * immédiatement.
 */
export function StepMapping({
  csv,
  mapping,
  onChange,
}: {
  csv: string
  mapping: Mapping
  onChange: (mapping: Mapping) => void
}) {
  const parsed = parseCsv(csv)
  const result = analyzeRows(parsed.headers, parsed.rows, mapping, parsed.totalDataLines)

  return (
    <div className="space-y-4">
      <Card
        title="Colonnes du fichier"
        hint="Indiquez quelle colonne porte la taille et laquelle porte l’adresse utilisée par le batch."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Colonne de taille" htmlFor="size-column">
            <select
              id="size-column"
              className={selectClass}
              value={mapping.sizeColumn ?? ''}
              onChange={(event) => onChange({ ...mapping, sizeColumn: event.target.value })}
            >
              <option value="">— Choisir —</option>
              {parsed.headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Colonne d’adresse (EmailAddress)" htmlFor="email-column">
            <select
              id="email-column"
              className={selectClass}
              value={mapping.emailColumn ?? ''}
              onChange={(event) => onChange({ ...mapping, emailColumn: event.target.value })}
            >
              <option value="">— Choisir —</option>
              {parsed.headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p className="mt-3 text-sm text-[color:var(--color-ink-muted)]">
          {result.rows.length} boîte(s) exploitable(s) sur {result.totalDataLines} ligne(s).
        </p>
      </Card>

      {mapping.sizeColumn !== null && (
        <Card title="Contrôle de la colonne de taille">
          <SizePreview csv={csv} column={mapping.sizeColumn} />
        </Card>
      )}

      {result.invalidRows.length > 0 && (
        <Notice level="warning" title={`${result.invalidRows.length} ligne(s) écartée(s)`}>
          Les lignes citées ci-dessous ne seront pas migrées. Corrigez le CSV d’origine si ce
          n’est pas attendu.
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
            {result.invalidRows.slice(0, 50).map((row) => (
              <li key={row.line} className="tabular-nums">
                Ligne {row.line} : {row.reason}
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  )
}

/** Relecture de la colonne de taille avec les valeurs réellement comprises. */
function SizePreview({ csv, column }: { csv: string; column: string }) {
  const parsed = parseCsv(csv)
  const samples = parsed.rows.slice(0, 200)
  const readable = samples.filter((row) => parseSizeMb(row[column] ?? '') !== null).length

  return (
    <div>
      <p className="text-sm">
        {readable} valeur(s) sur {samples.length} lue(s) comme un nombre.
      </p>
      <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {samples.slice(0, 6).map((row, index) => {
          const raw = row[column] ?? ''
          const mb = parseSizeMb(raw)
          return (
            <li key={index} className="flex justify-between gap-3 border-b pb-1">
              <span className="truncate text-[color:var(--color-ink-muted)]">{raw || '—'}</span>
              <span className={mb === null ? 'text-[color:var(--color-error)]' : ''}>
                {mb === null ? 'illisible' : formatSize(mb)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}