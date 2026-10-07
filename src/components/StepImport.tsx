'use client'

import { useRef, useState } from 'react'
import { detectColumns, formatNumber, parseCsv, type ParseResult } from '@/lib/parse'
import type { Mapping } from '@/lib/wizard'
import { Card, Notice, PrimaryButton, SecondaryButton } from './ui'

/**
 * Étape 1 : dépôt du CSV et contrôle qualité.
 *
 * Le fichier est lu avec FileReader, jamais envoyé. L'exemple fourni par
 * l'application est un fetch de /exemple.csv, également purement local.
 */
export function StepImport({
  csv,
  fileName,
  onCsv,
  onMapping,
}: {
  csv: string | null
  fileName: string | null
  onCsv: (csv: string, fileName: string) => void
  onMapping: (mapping: Mapping) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const result: ParseResult | null = csv === null ? null : parseCsv(csv)

  function readFile(file: File): void {
    if (file.size > 40 * 1024 * 1024) {
      setError('Fichier trop volumineux (40 Mo maximum). Exportez un CSV filtré sur les boîtes principales.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setError('Lecture du fichier impossible.')
        return
      }
      setError(null)
      onCsv(reader.result, file.name)
      const detected = detectColumns(parseCsv(reader.result).headers)
      onMapping(detected)
    }
    reader.onerror = () => setError('Lecture du fichier impossible.')
    reader.readAsText(file, 'utf-8')
  }

  async function loadExample(): Promise<void> {
    setError(null)
    try {
      const response = await fetch('/exemple.csv')
      if (!response.ok) {
        throw new Error(String(response.status))
      }
      const text = await response.text()
      onCsv(text, 'exemple.csv')
      onMapping(detectColumns(parseCsv(text).headers))
    } catch {
      setError('Exemple introuvable. Utilisez un fichier CSV local.')
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Fichier CSV"
        hint="Virgule, point-virgule ou tabulation (détecté automatiquement), première ligne = en-têtes. Boîte principale uniquement."
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file !== undefined) {
                readFile(file)
              }
            }}
          />
          <PrimaryButton onClick={() => inputRef.current?.click()}>
            Choisir un fichier CSV
          </PrimaryButton>
          <SecondaryButton onClick={() => void loadExample()}>
            Charger l’exemple
          </SecondaryButton>
          <span className="text-sm text-[color:var(--color-ink-muted)]">
            Le fichier reste dans votre navigateur : rien n’est envoyé sur internet.
          </span>
        </div>

        {error !== null && (
          <p className="mt-3 text-sm text-[color:var(--color-error)]" role="alert">
            {error}
          </p>
        )}
      </Card>

      {result !== null && (
        <>
          <Card title="Contrôle qualité">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Lignes" value={formatNumber(result.totalDataLines)} />
              <Stat label="Exploitables" value={formatNumber(result.rows.length)} tone="ok" />
              <Stat
                label="Écartées"
                value={formatNumber(result.invalidRows.length)}
                tone={result.invalidRows.length > 0 ? 'warn' : 'ok'}
              />
              <Stat label="Colonnes" value={formatNumber(result.headers.length)} />
            </dl>

            {result.issues.length > 0 && (
              <div className="mt-4 max-h-64 overflow-auto rounded-md border border-[color:var(--color-border)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[color:var(--color-surface-muted)] text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Ligne</th>
                      <th className="px-3 py-2 font-medium">Colonne</th>
                      <th className="px-3 py-2 font-medium">Problème</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues.slice(0, 200).map((issue, index) => (
                      <tr key={`${issue.line}-${issue.column ?? ''}-${index}`} className="border-t">
                        <td className="px-3 py-1.5 tabular-nums">{issue.line}</td>
                        <td className="px-3 py-1.5 text-[color:var(--color-ink-muted)]">
                          {issue.column ?? '—'}
                        </td>
                        <td className="px-3 py-1.5">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.issues.length > 200 && (
              <p className="mt-2 text-xs text-[color:var(--color-ink-muted)]">
                200 premiers problèmes affichés sur {formatNumber(result.issues.length)}.
              </p>
            )}
          </Card>

          {result.headers.length > 0 && (
            <Card title="Aperçu" hint={`${fileName ?? 'exemple.csv'} — 5 premières lignes`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left">
                    <tr>
                      {result.headers.map((header) => (
                        <th key={header} className="whitespace-nowrap px-3 py-2 font-medium">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 5).map((row, index) => (
                      <tr key={index} className="border-t">
                        {result.headers.map((header) => (
                          <td key={header} className="whitespace-nowrap px-3 py-1.5">
                            {row[header]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {result.issues.some((issue) => issue.kind === 'structure') && (
            <Notice level="warning" title="Mapping incomplet">
              Choisissez explicitement les colonnes taille et adresse à l’étape suivante pour
              continuer.
            </Notice>
          )}
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'ok' | 'warn'
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-[color:var(--color-ok)]'
      : tone === 'warn'
        ? 'text-[color:var(--color-warn)]'
        : ''
  return (
    <div className="rounded-md bg-[color:var(--color-surface-muted)] px-3 py-2">
      <dt className="text-xs text-[color:var(--color-ink-muted)]">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  )
}