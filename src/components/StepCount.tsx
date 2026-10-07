'use client'

import { MAX_DATABASES, MIN_DATABASES } from '@/lib/wizard'
import { Card, Notice } from './ui'

/** Étape 3 : nombre de bases de destination. */
export function StepCount({
  count,
  mailboxCount,
  onChange,
}: {
  count: number
  mailboxCount: number
  onChange: (count: number) => void
}) {
  return (
    <div className="space-y-4">
      <Card
        title="Nombre de bases de destination"
        hint="Entre 1 et 5. Le répartiteur équilibre les boîtes entre les bases de votre choix."
      >
        <fieldset>
          <legend className="sr-only">Nombre de bases</legend>
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: MAX_DATABASES - MIN_DATABASES + 1 }, (_, index) => index + 1).map(
              (value) => (
                <label
                  key={value}
                  className={`flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border-2 transition ${
                    count === value
                      ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]'
                      : 'border-[color:var(--color-border)] hover:border-[color:var(--color-accent)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="database-count"
                    value={value}
                    checked={count === value}
                    onChange={() => onChange(value)}
                    className="sr-only"
                  />
                  <span className="text-2xl font-semibold">{value}</span>
                  <span className="text-xs text-[color:var(--color-ink-muted)]">
                    {value === 1 ? 'base' : 'bases'}
                  </span>
                </label>
              ),
            )}
          </div>
        </fieldset>
      </Card>

      {count > mailboxCount && (
        <Notice level="warning" title="Plus de bases que de boîtes">
          Vous avez {mailboxCount} boîte(s) exploitable(s) pour {count} bases. Les bases en trop
          resteront vides : aucun CSV et aucune commande ne seront produits pour elles.
        </Notice>
      )}

      {mailboxCount > 0 && count > 1 && (
        <p className="text-sm text-[color:var(--color-ink-muted)]">
          Soit environ {Math.ceil(mailboxCount / count)} boîte(s) par base.
        </p>
      )}
    </div>
  )
}