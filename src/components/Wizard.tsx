'use client'

import { useMemo, useState } from 'react'
import { balanceMailboxes, toMailboxes } from '@/lib/balance'
import type { BatchParams } from '@/lib/exchange'
import { analyzeRows, parseCsv } from '@/lib/parse'
import {
  canReach,
  defaultBatchParams,
  initialState,
  STEPS,
  validateDatabaseNames,
  withBatchParams,
  withDatabaseCount,
  withDatabaseName,
  type WizardState,
  type WizardStep,
} from '@/lib/wizard'
import { StepCount } from './StepCount'
import { StepExport } from './StepExport'
import { StepImport } from './StepImport'
import { StepMapping } from './StepMapping'
import { StepNames } from './StepNames'
import { StepSummary } from './StepSummary'

export function Wizard() {
  const [state, setState] = useState<WizardState>(initialState)
  const [stepIndex, setStepIndex] = useState(0)

  const step = STEPS[stepIndex]?.id ?? 'import'

  // Recalcul systématique : changer N ou un nom suffit à mettre à jour le
  // tableau. Aucune validation intermédiaire n'est nécessaire.
  const analysis = useMemo(() => {
    if (state.csv === null || state.mapping.sizeColumn === null) {
      return null
    }
    const parsed = parseCsv(state.csv)
    const result = analyzeRows(parsed.headers, parsed.rows, state.mapping, parsed.totalDataLines)
    const mailboxes = toMailboxes(result.rows, state.mapping.sizeColumn, state.mapping.emailColumn ?? '')
    const summary = balanceMailboxes({ mailboxes, databaseNames: state.databaseNames })
    return { parsed, result, summary }
  }, [state.csv, state.mapping, state.databaseNames])

  // Les paramètres par base sont créés à la volée pour ne pas imposer d'ordre
  // de saisie ; le wizard lit la base comme clé.
  const paramsByDatabase = useMemo(() => {
    const entries: Record<string, BatchParams> = {}
    for (const name of state.databaseNames) {
      entries[name] = state.batchParams[name] ?? defaultBatchParams(name)
    }
    return entries
  }, [state.databaseNames, state.batchParams])

  function goTo(next: WizardStep): void {
    const index = STEPS.findIndex((candidate) => candidate.id === next)
    if (index >= 0) {
      setStepIndex(index)
    }
  }

  const namesValid = validateDatabaseNames(state.databaseNames).every((e) => e === undefined)
  const canGoNext =
    step === 'import'
      ? analysis !== null && analysis.result.rows.length > 0
      : step === 'mapping'
        ? canReach(state, 'names')
        : step === 'names'
          ? namesValid
          : true

  return (
    <div className="min-h-screen">
      <header className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h1 className="text-xl font-semibold sm:text-2xl">Exchange DB Balancer</h1>
          <p className="mt-1 max-w-2xl text-sm text-[color:var(--color-ink-muted)]">
            Répartissez vos boîtes aux lettres Exchange sur plusieurs bases de destination, puis
            générez les batchs de migration. Tout se passe dans votre navigateur.
          </p>
        </div>
      </header>

      <nav aria-label="Étapes" className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <ol className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-3">
          {STEPS.map((candidate, index) => {
            const reachable = canReach(state, candidate.id)
            const current = candidate.id === step
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => reachable && goTo(candidate.id)}
                  disabled={!reachable}
                  aria-current={current ? 'step' : undefined}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition ${
                    current
                      ? 'bg-[color:var(--color-accent-soft)] font-medium text-[color:var(--color-accent)]'
                      : reachable
                        ? 'hover:bg-[color:var(--color-surface-muted)]'
                        : 'cursor-not-allowed opacity-40'
                  }`}
                >
                  <span className="tabular-nums">{index + 1}.</span> {candidate.label}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {step === 'import' && (
          <StepImport
            csv={state.csv}
            fileName={state.fileName}
            onCsv={(csv, fileName) => setState((s) => ({ ...s, csv, fileName }))}
            onMapping={(mapping) => setState((s) => ({ ...s, mapping }))}
          />
        )}

        {step === 'mapping' && state.csv !== null && (
          <StepMapping
            csv={state.csv}
            mapping={state.mapping}
            onChange={(mapping) => setState((s) => ({ ...s, mapping }))}
          />
        )}

        {step === 'count' && analysis !== null && (
          <StepCount
            count={state.databaseCount}
            mailboxCount={analysis.result.rows.length}
            onChange={(count) => setState((s) => withDatabaseCount(s, count))}
          />
        )}

        {step === 'names' && (
          <StepNames
            names={state.databaseNames}
            onChange={(index, name) => setState((s) => withDatabaseName(s, index, name))}
          />
        )}

        {step === 'summary' && analysis !== null && (
          <StepSummary summary={analysis.summary} names={state.databaseNames} />
        )}

        {step === 'export' && analysis !== null && (
          <StepExport
            summary={analysis.summary}
            headers={analysis.parsed.headers}
            paramsByDatabase={paramsByDatabase}
            onParams={(database, params) =>
              setState((s) => withBatchParams(s, database, params))
            }
          />
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
            disabled={stepIndex === 0}
            className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm disabled:opacity-40"
          >
            Retour
          </button>
          <button
            type="button"
            onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}
            disabled={!canGoNext || stepIndex === STEPS.length - 1}
            className="rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Continuer
          </button>
        </div>
      </main>
    </div>
  )
}