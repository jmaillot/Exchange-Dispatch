'use client'

import { useState } from 'react'
import type { BalanceSummary } from '@/lib/balance'
import { buildZip, CSV_MIME, downloadText, downloadZip, POWERSHELL_MIME } from '@/lib/download'
import {
  buildBatchCsv,
  buildScript,
  buildTextExports,
  preMigrationChecks,
  SCRIPT_FILE_NAME,
  SERVER_STEPS,
  type BatchParamsByDatabase,
} from '@/lib/exchange'
import type { BatchParams } from '@/lib/exchange'
import { Card, Field, Notice, PrimaryButton, SecondaryButton, inputClass } from './ui'

/** Bouton copier avec confirmation visuelle brève. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé) : l’utilisateur
      // sélectionne le texte manuellement.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="shrink-0 rounded border border-[color:var(--color-border)] px-2 py-1 text-xs hover:bg-[color:var(--color-surface-muted)]"
      aria-live="polite"
    >
      {copied ? 'Copié ✓' : 'Copier'}
    </button>
  )
}

/** Étape 6 : paramètres des batchs, avertissements et téléchargement. */
export function StepExport({
  summary,
  headers,
  paramsByDatabase,
  onParams,
}: {
  summary: BalanceSummary
  headers: string[]
  paramsByDatabase: BatchParamsByDatabase
  onParams: (database: string, params: BatchParams) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const checks = preMigrationChecks(summary.assignments, paramsByDatabase)
  const files = buildTextExports(summary, paramsByDatabase, headers)
  const zipName = 'migration-exchange.zip'

  async function downloadAll(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const blob = await buildZip(files)
      downloadZip(zipName, blob)
    } catch {
      setError('Génération du ZIP impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Paramètres des batchs"
        hint="Modifiables par base. Les valeurs s'appliquent à la commande New-MigrationBatch correspondante."
      >
        <div className="space-y-6">
          {summary.assignments
            .filter((assignment) => assignment.count > 0)
            .map((assignment) => {
              const params = paramsByDatabase[assignment.name]
              if (params === undefined) {
                return null
              }
              const update = (patch: Partial<BatchParams>) =>
                onParams(assignment.name, { ...params, ...patch })

              return (
                <fieldset key={assignment.name} className="rounded-md border border-[color:var(--color-border)] p-4">
                  <legend className="px-1 text-sm font-semibold">
                    {assignment.name} — {assignment.count} boîte(s)
                  </legend>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nom du batch" htmlFor={`batch-${assignment.name}`}>
                      <input
                        id={`batch-${assignment.name}`}
                        className={inputClass}
                        value={params.batchName}
                        onChange={(event) => update({ batchName: event.target.value })}
                      />
                    </Field>

                    <Field
                      label="Adresses de notification"
                      hint="Séparées par des virgules. Facultatif."
                      htmlFor={`notif-${assignment.name}`}
                    >
                      <input
                        id={`notif-${assignment.name}`}
                        className={inputClass}
                        defaultValue={params.notificationEmails.join(', ')}
                        onBlur={(event) => {
                          const emails = event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter((value) => value !== '')
                          update({ notificationEmails: emails })
                        }}
                        spellCheck={false}
                      />
                    </Field>

                    <Field label="BadItemLimit" htmlFor={`bad-${assignment.name}`}>
                      <input
                        id={`bad-${assignment.name}`}
                        type="number"
                        min={0}
                        className={inputClass}
                        value={params.badItemLimit}
                        onChange={(event) => update({ badItemLimit: Number(event.target.value) || 0 })}
                      />
                    </Field>

                    <Field label="LargeItemLimit" htmlFor={`large-${assignment.name}`}>
                      <input
                        id={`large-${assignment.name}`}
                        type="number"
                        min={1}
                        className={inputClass}
                        value={params.largeItemLimit}
                        onChange={(event) =>
                          update({ largeItemLimit: Math.max(1, Number(event.target.value) || 1) })
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={params.autoStart}
                        onChange={(event) => update({ autoStart: event.target.checked })}
                      />
                      -AutoStart
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={params.autoComplete}
                        onChange={(event) => update({ autoComplete: event.target.checked })}
                      />
                      -AutoComplete
                    </label>
                  </div>

                  {!params.autoComplete && (
                    <p className="mt-3 text-sm text-[color:var(--color-warn)]">
                      Sans <code className="font-mono">-AutoComplete</code>, ce batch devra être
                      finalisé avec <code className="font-mono">Complete-MigrationBatch</code>.
                    </p>
                  )}
                </fieldset>
              )
            })}
        </div>
      </Card>

      <Card title="Avant de lancer la migration">
        <div className="space-y-3">
          {checks.map((check) => (
            <Notice key={check.title} level={check.level} title={check.title}>
              {check.detail}
            </Notice>
          ))}
        </div>
      </Card>

      <Card
        title="Sur le serveur Exchange"
        hint="Dans l’ordre, depuis l’Exchange Management Shell. Le script .ps1 embarque la même liste en commentaire."
      >
        <ol className="space-y-4">
          {SERVER_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-accent-soft)] text-xs font-semibold text-[color:var(--color-accent)]"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-sm text-[color:var(--color-ink-muted)]">{step.detail}</p>
                {step.command !== undefined && (
                  <div className="mt-2 flex items-start gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded bg-[color:var(--color-surface-muted)] px-2 py-1.5 font-mono text-xs break-all">
                      {step.command}
                    </code>
                    <CopyButton text={step.command} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Téléchargement">
        <div className="flex flex-wrap gap-3">
          <PrimaryButton onClick={() => void downloadAll()} disabled={busy}>
            {busy ? 'Génération…' : 'Télécharger le ZIP'}
          </PrimaryButton>
          <SecondaryButton
            onClick={() =>
              downloadText(
                SCRIPT_FILE_NAME,
                buildScript(summary, paramsByDatabase),
                POWERSHELL_MIME,
              )
            }
          >
            Script .ps1 seul
          </SecondaryButton>
          {summary.assignments
            .filter((assignment) => assignment.count > 0 && paramsByDatabase[assignment.name] !== undefined)
            .map((assignment) => (
              <SecondaryButton
                key={assignment.name}
                onClick={() =>
                  downloadText(
                    `batch-${paramsByDatabase[assignment.name]?.batchName ?? assignment.name}.csv`,
                    buildBatchCsv(assignment, headers),
                    CSV_MIME,
                  )
                }
              >
                CSV {assignment.name}
              </SecondaryButton>
            ))}
        </div>

        {error !== null && (
          <p className="mt-3 text-sm text-[color:var(--color-error)]" role="alert">
            {error}
          </p>
        )}

        <p className="mt-3 text-sm text-[color:var(--color-ink-muted)]">
          Le ZIP contient {files.length} fichiers : les CSV par base, le script PowerShell et le
          récapitulatif de la répartition.
        </p>
      </Card>

      <Card title="Aperçu des fichiers">
        <div className="space-y-4">
          {files.map((file) => (
            <details key={file.fileName} className="rounded-md border border-[color:var(--color-border)]">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                {file.fileName}
              </summary>
              <pre className="max-h-72 overflow-auto border-t p-3 text-xs leading-relaxed">
                {file.content.slice(0, 4000)}
              </pre>
            </details>
          ))}
        </div>
      </Card>
    </div>
  )
}