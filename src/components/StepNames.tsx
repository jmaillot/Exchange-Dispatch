'use client'

import { validateDatabaseNames } from '@/lib/wizard'
import { Card, Field, inputClass } from './ui'

/** Étape 4 : nom de chaque base de destination. */
export function StepNames({
  names,
  onChange,
}: {
  names: string[]
  onChange: (index: number, name: string) => void
}) {
  const errors = validateDatabaseNames(names)
  const valid = errors.filter((error) => error !== undefined).length === 0

  return (
    <Card
      title="Noms des bases"
      hint="Lettres, chiffres, point, tiret et tiret bas uniquement, sans espace. Chaque nom doit être unique."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {names.map((name, index) => (
          <Field
            key={index}
            label={`Base ${index + 1}`}
            htmlFor={`db-name-${index}`}
            error={errors[index]}
          >
            <input
              id={`db-name-${index}`}
              className={inputClass}
              value={name}
              onChange={(event) => onChange(index, event.target.value)}
              aria-invalid={errors[index] !== undefined}
              spellCheck={false}
            />
          </Field>
        ))}
      </div>

      {!valid && (
        <p className="mt-4 text-sm text-[color:var(--color-error)]" role="alert">
          Corrigez les noms en surbrillance pour continuer.
        </p>
      )}
    </Card>
  )
}