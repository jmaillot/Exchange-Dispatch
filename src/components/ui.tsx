import type { ReactNode } from 'react'

/** Carte de section, avec titre et sous-titre optionnels. */
export function Card({
  title,
  hint,
  children,
}: {
  title?: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-5 shadow-sm">
      {title !== undefined && <h2 className="text-base font-semibold">{title}</h2>}
      {hint !== undefined && (
        <p className="mt-1 text-sm text-[color:var(--color-ink-muted)]">{hint}</p>
      )}
      <div className={title === undefined ? '' : 'mt-4'}>{children}</div>
    </section>
  )
}

const LEVEL_STYLES = {
  danger: 'border-[color:var(--color-error)] bg-[color:var(--color-error-soft)]',
  warning: 'border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]',
  info: 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]',
} as const

const LEVEL_LABELS = {
  danger: 'À vérifier imperativement',
  warning: 'À vérifier',
  info: 'Bon à savoir',
} as const

/** Bandeau d'avertissement, du plus grave au plus informatif. */
export function Notice({
  level,
  title,
  children,
}: {
  level: keyof typeof LEVEL_STYLES
  title: string
  children: ReactNode
}) {
  return (
    <div className={`rounded-md border-l-4 p-3 ${LEVEL_STYLES[level]}`}>
      <p className="text-sm font-semibold">
        <span className="sr-only">{LEVEL_LABELS[level]} : </span>
        {title}
      </p>
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </div>
  )
}

/** Bouton d'action principale. */
export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[color:var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  )
}

/** Bouton secondaire. */
export function SecondaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
      {...props}
    >
      {children}
    </button>
  )
}

/** Champ de formulaire étiqueté. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {hint !== undefined && (
        <p className="mt-0.5 text-xs text-[color:var(--color-ink-muted)]">{hint}</p>
      )}
      <div className="mt-1.5">{children}</div>
      {error !== undefined && (
        <p className="mt-1 text-xs text-[color:var(--color-error)]" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export const inputClass =
  'w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm'

export const selectClass =
  'w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm'