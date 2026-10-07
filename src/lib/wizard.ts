import { databaseNameSchema, type BatchParams } from './exchange'

/**
 * État du wizard et transitions. Fonctions pures : le composant ne fait que
 * déduire le nouvel état et l'appliquer.
 *
 * Aucun stockage persistant : tout vit en mémoire, recharger la page repart
 * de zéro. C'est une contrainte (rien ne doit fuir du navigateur), pas un
 * oubli.
 */

export const MIN_DATABASES = 1
export const MAX_DATABASES = 5

export type Mapping = {
  sizeColumn: string | null
  emailColumn: string | null
}

export type WizardState = {
  fileName: string | null
  csv: string | null
  mapping: Mapping
  databaseCount: number
  databaseNames: string[]
  batchParams: Record<string, BatchParams>
  notificationDraft: Record<string, string>
}

export type WizardStep = 'import' | 'mapping' | 'count' | 'names' | 'summary' | 'export'

export const STEPS: ReadonlyArray<{ id: WizardStep; label: string }> = [
  { id: 'import', label: 'Import' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'count', label: 'Bases' },
  { id: 'names', label: 'Noms' },
  { id: 'summary', label: 'Répartition' },
  { id: 'export', label: 'Export' },
]

export const initialState: WizardState = {
  fileName: null,
  csv: null,
  mapping: { sizeColumn: null, emailColumn: null },
  databaseCount: 2,
  databaseNames: defaultNames(2),
  batchParams: {},
  notificationDraft: {},
}

export function defaultNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `MigrationDB${String(index + 1).padStart(2, '0')}`)
}

export function defaultBatchParams(batchName: string): BatchParams {
  return {
    batchName,
    autoStart: true,
    autoComplete: true,
    badItemLimit: 0,
    largeItemLimit: 100,
    notificationEmails: [],
  }
}

/**
 * Change le nombre de bases en gardant les noms déjà saisis.
 *
 * Reprendre un nom existant évite de ressaisir 3 bases quand on passe de 3 à
 * 4 pour tester. Au-delà de 5, les bases en trop sont retirées.
 */
export function withDatabaseCount(state: WizardState, count: number): WizardState {
  const clamped = Math.min(MAX_DATABASES, Math.max(MIN_DATABASES, count))
  const names = state.databaseNames.slice(0, clamped)
  while (names.length < clamped) {
    names.push(defaultNames(count)[names.length] ?? `MigrationDB${names.length + 1}`)
  }

  return { ...state, databaseCount: clamped, databaseNames: names }
}

/** Remplace le nom d'une base ; l'index reste la référence. */
export function withDatabaseName(state: WizardState, index: number, name: string): WizardState {
  const databaseNames = state.databaseNames.map((existing, i) => (i === index ? name : existing))
  return { ...state, databaseNames }
}

export function withBatchParams(
  state: WizardState,
  database: string,
  params: BatchParams,
): WizardState {
  return {
    ...state,
    batchParams: { ...state.batchParams, [database]: params },
  }
}

/**
 * Erreurs de saisie des noms de bases, indexées par position.
 *
 * L'unicité est vérifiée sur la version normalisée (minuscules, sans
 * espaces) : Exchange considère `db01` et `DB01` comme deux bases, ce qui
 * surprendrait l'utilisateur.
 */
export function validateDatabaseNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  const errors: string[] = []

  names.forEach((name, index) => {
    const parsed = databaseNameSchema.safeParse(name)
    if (!parsed.success) {
      errors[index] = parsed.error.issues[0]?.message ?? 'Nom invalide.'
      return
    }

    const key = name.trim().toLowerCase()
    const firstSeen = seen.get(key)
    if (firstSeen !== undefined) {
      errors[index] = `Déjà utilisé par la base ${firstSeen + 1}.`
      return
    }
    seen.set(key, index)
  })

  return errors
}

/** Une étape est-elle accessible ? */
export function canReach(state: WizardState, step: WizardStep): boolean {
  switch (step) {
    case 'import':
      return true
    case 'mapping':
      return state.csv !== null
    case 'count':
      return state.mapping.sizeColumn !== null && state.mapping.emailColumn !== null
    case 'names':
      return state.mapping.sizeColumn !== null && state.mapping.emailColumn !== null
    case 'summary':
      return (
        state.csv !== null &&
        state.mapping.sizeColumn !== null &&
        state.mapping.emailColumn !== null &&
        validateDatabaseNames(state.databaseNames).every((error) => error === undefined)
      )
    case 'export':
      return (
        state.csv !== null &&
        state.mapping.sizeColumn !== null &&
        state.mapping.emailColumn !== null &&
        validateDatabaseNames(state.databaseNames).every((error) => error === undefined)
      )
  }
}