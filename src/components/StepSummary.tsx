'use client'

import type { BalanceSummary } from '@/lib/balance'
import { formatNumber, formatSize } from '@/lib/parse'
import { Card, Notice } from './ui'

/**
 * Étape 5 : récapitulatif de la répartition.
 *
 * Le calcul est refait à chaque rendu : changer le nombre de bases ou un nom
 * ne demande pas de valider quoi que ce soit.
 */
export function StepSummary({
  summary,
  names,
}: {
  summary: BalanceSummary
  names: string[]
}) {
  const spreadPercent =
    summary.averageMb > 0 ? (summary.spreadMb / summary.averageMb) * 100 : 0

  return (
    <div className="space-y-4">
      <Card
        title="Répartition"
        hint="Taille totale par base et écart à la moyenne. Modifiez le nombre de bases ou un nom pour recalculer."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Base</th>
                <th className="px-3 py-2 text-right font-medium">Boîtes</th>
                <th className="px-3 py-2 text-right font-medium">Taille</th>
                <th className="px-3 py-2 text-right font-medium">Écart à la moyenne</th>
                <th className="px-3 py-2 font-medium">Part</th>
              </tr>
            </thead>
            <tbody>
              {summary.assignments.map((assignment, index) => {
                const deviation = summary.deviationMb[index] ?? 0
                const share =
                  summary.totalMb > 0 ? (assignment.totalMb / summary.totalMb) * 100 : 0
                return (
                  <tr key={assignment.name} className="border-t">
                    <td className="px-3 py-2 font-medium">{assignment.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{assignment.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatSize(assignment.totalMb)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        deviation > 0.05 ? 'text-[color:var(--color-warn)]' : ''
                      }`}
                    >
                      {assignment.count === 0 ? '—' : formatNumber(deviation) + ' Mo'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="block h-2 rounded-full bg-[color:var(--color-accent)]"
                        style={{ width: `${Math.max(share, assignment.count > 0 ? 2 : 0)}%` }}
                        aria-hidden="true"
                      />
                      <span className="sr-only">{formatNumber(share)} pour cent</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t-2">
              <tr>
                <td className="px-3 py-2 font-semibold">Total</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {summary.assignments.reduce((sum, a) => sum + a.count, 0)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatSize(summary.totalMb)}
                </td>
                <td className="px-3 py-2 text-right text-[color:var(--color-ink-muted)]">
                  moyenne {formatNumber(summary.averageMb)} Mo
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Écart entre bases">
          <p className="text-2xl font-semibold tabular-nums">{formatSize(summary.spreadMb)}</p>
          <p className="mt-1 text-sm text-[color:var(--color-ink-muted)]">
            {spreadPercent < 0.01
              ? 'Répartition parfaite.'
              : `Soit ${formatNumber(spreadPercent)} % de la moyenne.`}
          </p>
        </Card>

        <Card title="Bases vides">
          <p className="text-2xl font-semibold tabular-nums">{summary.emptyDatabaseCount}</p>
          <p className="mt-1 text-sm text-[color:var(--color-ink-muted)]">
            {summary.emptyDatabaseCount === 0
              ? 'Toutes les bases reçoivent au moins une boîte.'
              : 'Aucun CSV ni commande ne sera produit pour elles.'}
          </p>
        </Card>
      </div>

      {summary.emptyDatabaseCount > 0 && (
        <Notice level="warning" title="Bases vides">
          {names
            .filter((name) =>
              summary.assignments.some((a) => a.name === name && a.count === 0),
            )
            .join(', ')}{' '}
          ne recevront aucune boîte. Aucun CSV et aucune commande
          <code className="mx-1 rounded bg-[color:var(--color-surface-muted)] px-1 text-xs">
            New-MigrationBatch
          </code>
          ne seront générés pour ces bases : un batch sans destinataire échouerait sur le
          serveur.
        </Notice>
      )}

      <Card title="Détail par base">
        <div className="space-y-4">
          {summary.assignments.map((assignment) => (
            <details key={assignment.name} className="rounded-md border border-[color:var(--color-border)]">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                {assignment.name} — {assignment.count} boîte(s), {formatSize(assignment.totalMb)}
              </summary>
              <ul className="max-h-56 overflow-auto border-t px-3 py-2 text-sm">
                {assignment.mailboxes.map((mailbox) => (
                  <li
                    key={mailbox.index}
                    className="flex justify-between gap-3 border-b py-1 last:border-0"
                  >
                    <span className="truncate">{mailbox.email}</span>
                    <span className="whitespace-nowrap tabular-nums text-[color:var(--color-ink-muted)]">
                      {formatSize(mailbox.sizeMb)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Card>
    </div>
  )
}