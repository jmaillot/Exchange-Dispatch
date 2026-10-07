import { parseSizeMb, type RawRow } from './parse'

/**
 * Répartition de boîtes aux lettres sur N bases de destination, de taille la
 * plus proche possible.
 *
 * Deux passes :
 *  1. LPT (Longest Processing Time) — tri décroissant puis placement glouton
 *     dans la base la plus légère. En un balayage, LPT garantit un écart
 *     max-min inférieur ou égal à la plus grande boîte : déjà correct, mais
 *     rarement optimal.
 *  2. Amélioration locale — déplacements et échanges tant qu'ils réduisent
 *     l'écart max-min.
 *
 * Déterminisme : le tri départage les égalités par la position d'origine dans
 * le fichier, et chaque passe applique toujours le meilleur mouvement trouvé,
 * jamais le premier. Mêmes entrées = même sortie.
 *
 * Les bases vides sont hors de l'objectif : quand il y a moins de boîtes que
 * de bases, l'algorithme répartit les boîtes présentes aussi également que
 * possible plutôt que de laisser une base absorber le surplus.
 */

export type Mailbox = {
  /** Position dans le CSV d'origine, base 0. Sert au départage déterministe. */
  readonly index: number
  readonly email: string
  readonly sizeMb: number
  readonly row: RawRow
}

export type DatabaseAssignment = {
  /** Base choisie par l'utilisateur. */
  readonly name: string
  readonly mailboxes: Mailbox[]
  readonly totalMb: number
  readonly count: number
}

export type BalanceSummary = {
  readonly assignments: DatabaseAssignment[]
  readonly totalMb: number
  readonly averageMb: number
  /** Écart max-min sur les bases contenant au moins une boîte. */
  readonly spreadMb: number
  /** Écart absolu de chaque base à la moyenne, dans l'ordre des bases. */
  readonly deviationMb: number[]
  /** Nombre de bases sans aucune boîte. */
  readonly emptyDatabaseCount: number
}

export type BalanceInput = {
  readonly mailboxes: readonly Mailbox[]
  readonly databaseNames: readonly string[]
}

type Bin = {
  name: string
  load: number
  items: Mailbox[]
}

/** Un déplacement ou un échange, avec le coût qu'il produirait. */
type Candidate = {
  apply: () => void
  nextCost: readonly [number, number]
}

const EPSILON = 1e-9

/** Lignes CSV validées -> boîtes aux lettres, en sautant les tailles illisibles. */
export function toMailboxes(
  rows: readonly RawRow[],
  sizeColumn: string,
  emailColumn: string,
): Mailbox[] {
  const mailboxes: Mailbox[] = []
  rows.forEach((row, index) => {
    const size = parseSizeMb(row[sizeColumn] ?? '')
    if (size === null) {
      return
    }
    mailboxes.push({
      index,
      email: (row[emailColumn] ?? '').trim(),
      sizeMb: size,
      row,
    })
  })
  return mailboxes
}

/** Tri décroissant par taille, égalités départagées par position d'origine. */
function bySizeDescending(a: Mailbox, b: Mailbox): number {
  if (b.sizeMb !== a.sizeMb) {
    return b.sizeMb - a.sizeMb
  }
  return a.index - b.index
}

/** Charges des bases non vides. */
function loads(bins: readonly Bin[]): number[] {
  return bins.filter((bin) => bin.items.length > 0).map((bin) => bin.load)
}

/** Écart max-min tel qu'affiché à l'utilisateur : bases non vides seulement. */
function spread(bins: readonly Bin[]): number {
  const values = loads(bins)
  if (values.length === 0) {
    return 0
  }
  return Math.max(...values) - Math.min(...values)
}

/**
 * Écart max-min sur *toutes* les bases, une base vide comptant pour zéro.
 *
 * C'est la variante utilisée pour optimiser. Sans elle, un découpage qui vide
 * une base ferait passer deux bases identiques à un écart de zéro : le
 * coût s'effondrerait et l'algorithme rewarded l'abandon d'une base.
 */
function spreadAll(bins: readonly Bin[]): number {
  if (bins.length === 0) {
    return 0
  }
  const values = bins.map((bin) => bin.load)
  return Math.max(...values) - Math.min(...values)
}

/**
 * Somme des écarts carrés à la moyenne, sur les bases non vides.
 *
 * Sert de second critère : à écart max-min identique, c'est elle qui
 * départage deux découpages et qui donne à la descente un gradient là où le
 * max-min est plat.
 */
function varianceCost(bins: readonly Bin[]): number {
  const values = bins.map((bin) => bin.load)
  if (values.length === 0) {
    return 0
  }
  const total = values.reduce((sum, load) => sum + load, 0)
  const mean = total / values.length
  return values.reduce((sum, load) => sum + (load - mean) ** 2, 0)
}

/**
 * Coût d'un découpage, comparé lexicographiquement : l'écart max-min d'abord
 * (c'est l'objectif demandé), la variance ensuite pour casser les égalités.
 *
 * Sans le second critère, la descente s'arrête dès qu'un déplacement ne
 * change plus le max-min — or beaucoup de déplacements améliorent les bases
 * intermédiaires sans toucher aux extrêmes.
 */
function cost(bins: readonly Bin[]): readonly [number, number] {
  return [spreadAll(bins), varianceCost(bins)]
}

/** Coût strictement inférieur ? */
function isBetter(next: readonly [number, number], previous: readonly [number, number]): boolean {
  if (next[0] < previous[0] - EPSILON) {
    return true
  }
  return Math.abs(next[0] - previous[0]) <= EPSILON && next[1] < previous[1] - EPSILON
}

/** Index de la base la plus légère ; égalités départagées par index croissant. */
function lightestBin(bins: readonly Bin[]): number {
  let best = 0
  for (let i = 1; i < bins.length; i += 1) {
    const candidate = bins[i]
    const current = bins[best]
    if (candidate !== undefined && current !== undefined && candidate.load < current.load - EPSILON) {
      best = i
    }
  }
  return best
}

function lpt(mailboxes: readonly Mailbox[], databaseNames: readonly string[]): Bin[] {
  const bins: Bin[] = databaseNames.map((name) => ({ name, load: 0, items: [] }))
  const ordered = [...mailboxes].sort(bySizeDescending)

  for (const mailbox of ordered) {
    const target = lightestBin(bins)
    const bin = bins[target]
    if (bin === undefined) {
      continue
    }
    bin.load += mailbox.sizeMb
    bin.items.push(mailbox)
  }

  return bins
}

/**
 * Cherche le meilleur déplacement et le meilleur échange selon la variance,
 * sans rien appliquer.
 */
/**
 * Cherche le meilleur déplacement et le meilleur échange, sans rien
 * appliquer. Chaque candidat est évalué puis immédiatement annulé.
 */
function findBestCandidate(bins: Bin[], before: readonly [number, number]): Candidate | null {
  if (before[0] <= EPSILON && before[1] <= EPSILON) {
    return null
  }

  let best: Candidate | null = null

  const consider = (nextCost: readonly [number, number], apply: () => void): void => {
    if (!isBetter(nextCost, before)) {
      return
    }
    if (best === null || isBetter(nextCost, best.nextCost)) {
      best = { apply, nextCost }
    }
  }

  for (let from = 0; from < bins.length; from += 1) {
    for (let to = 0; to < bins.length; to += 1) {
      if (from === to) {
        continue
      }
      const source = bins[from]
      const destination = bins[to]
      if (source === undefined || destination === undefined) {
        continue
      }

      for (const item of source.items) {
        source.load -= item.sizeMb
        destination.load += item.sizeMb
        const nextCost = cost(bins)
        destination.load -= item.sizeMb
        source.load += item.sizeMb

        consider(nextCost, () => {
          source.items = source.items.filter((other) => other !== item)
          source.load -= item.sizeMb
          destination.items.push(item)
          destination.load += item.sizeMb
        })
      }
    }
  }

  for (let a = 0; a < bins.length; a += 1) {
    for (let b = a + 1; b < bins.length; b += 1) {
      const binA = bins[a]
      const binB = bins[b]
      if (binA === undefined || binB === undefined) {
        continue
      }

      for (const itemA of binA.items) {
        for (const itemB of binB.items) {
          binA.load += itemB.sizeMb - itemA.sizeMb
          binB.load += itemA.sizeMb - itemB.sizeMb
          const nextCost = cost(bins)
          binB.load -= itemA.sizeMb - itemB.sizeMb
          binA.load -= itemB.sizeMb - itemA.sizeMb

          consider(nextCost, () => {
            binA.items = binA.items.map((item) => (item === itemA ? itemB : item))
            binB.items = binB.items.map((item) => (item === itemB ? itemA : item))
            binA.load += itemB.sizeMb - itemA.sizeMb
            binB.load += itemA.sizeMb - itemB.sizeMb
          })
        }
      }
    }
  }

  return best
}

/**
 * Nombre de passes maximal. Chaque passe applique strictement un gain de
 * variance positif, donc chaque passe rapproche d'un minimum local : la
 * borne ne sert que de garde-fou sur de très gros volumes.
 */
const MAX_PASSES = 500

function cloneBins(bins: readonly Bin[]): Bin[] {
  return bins.map((bin) => ({ name: bin.name, load: bin.load, items: [...bin.items] }))
}

/** Fait converger la recherche locale sur un optimum local. */
function descend(bins: Bin[]): void {
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const candidate = findBestCandidate(bins, cost(bins))
    if (candidate === null) {
      return
    }
    candidate.apply()
  }
}

/** Déplace un élément d'une base vers une autre. */
function transfer(source: Bin, destination: Bin, item: Mailbox): void {
  source.items = source.items.filter((other) => other !== item)
  source.load -= item.sizeMb
  destination.items.push(item)
  destination.load += item.sizeMb
}

/** Index des bases triées par charge décroissante. */
function byLoadDescending(bins: readonly Bin[]): number[] {
  return bins
    .map((bin, index) => index)
    .sort((a, b) => {
      const diff = (bins[b]?.load ?? 0) - (bins[a]?.load ?? 0)
      return diff !== 0 ? diff : a - b
    })
}

/** N-ième plus gros élément d'une base (0 = le plus gros). */
function nthLargest(bin: Bin, rank: number): Mailbox | undefined {
  const sorted = [...bin.items].sort(bySizeDescending)
  return sorted[rank]
}

/**
 * Secousses déterministes pour sortir d'un optimum local.
 *
 * L'écart max-min est un objectif plat : nombre de mouvements improve les
 * bases intermédiaires sans toucher aux extrêmes, donc le coût ne bouge pas
 * et la descente s'arrête. Il reste pourtant presque toujours un couloir vers
 * une configuration meilleure, qui demande plusieurs mouvements consécutifs.
 *
 * On alterne donc quatre perturbations complémentaires et on ne conserve que
 * les essais qui améliorent le coût. Le cycle est déterministe : mêmes
 * entrées, même suite d'essais, même résultat.
 */
function perturb(bins: Bin[], round: number): boolean {
  const order = byLoadDescending(bins)
  const heaviestIndex = order[0]
  const lightestIndex = order[order.length - 1]
  if (heaviestIndex === undefined || lightestIndex === undefined) {
    return false
  }

  const heaviest = bins[heaviestIndex]
  const lightest = bins[lightestIndex]
  if (heaviest === undefined || lightest === undefined || heaviest === lightest) {
    return false
  }

  switch (round % 4) {
    case 0: {
      const item = nthLargest(heaviest, 0)
      if (item === undefined) {
        return false
      }
      transfer(heaviest, lightest, item)
      return true
    }
    case 1: {
      const item = nthLargest(heaviest, 0)
      if (item === undefined) {
        return false
      }
      transfer(heaviest, lightest, item)
      const second = nthLargest(heaviest, 0)
      if (second !== undefined) {
        transfer(heaviest, lightest, second)
      }
      return true
    }
    case 2: {
      const item = nthLargest(heaviest, round % Math.max(1, heaviest.items.length))
      if (item === undefined) {
        return false
      }
      transfer(heaviest, lightest, item)
      return true
    }
    default: {
      const item = nthLargest(heaviest, 0)
      const target = nthLargest(lightest, 0)
      if (item === undefined || target === undefined) {
        return false
      }
      transfer(heaviest, lightest, item)
      transfer(lightest, heaviest, target)
      return true
    }
  }
}

/** Nombre de secousses tentées entre deux descentes. */
const MAX_PERTURBATIONS = 200

/** Répartit les boîtes aux lettres sur les bases nommées (1 à 5). */
export function balanceMailboxes({ mailboxes, databaseNames }: BalanceInput): BalanceSummary {
  const bins = lpt(mailboxes, databaseNames)
  descend(bins)

  let best = cloneBins(bins)
  let bestCost = cost(bins)

  for (let attempt = 0; attempt < MAX_PERTURBATIONS; attempt += 1) {
    const trial = cloneBins(best)
    if (!perturb(trial, attempt)) {
      continue
    }
    descend(trial)
    const trialCost = cost(trial)
    if (isBetter(trialCost, bestCost)) {
      best = trial
      bestCost = trialCost
    }
  }

  const assignments: DatabaseAssignment[] = best.map((bin) => ({
    name: bin.name,
    mailboxes: [...bin.items].sort(bySizeDescending),
    totalMb: bin.load,
    count: bin.items.length,
  }))

  const totalMb = assignments.reduce((sum, assignment) => sum + assignment.totalMb, 0)
  const averageMb = assignments.length === 0 ? 0 : totalMb / assignments.length

  return {
    assignments,
    totalMb,
    averageMb,
    spreadMb: spread(best),
    deviationMb: assignments.map((assignment) => Math.abs(assignment.totalMb - averageMb)),
    emptyDatabaseCount: assignments.filter((assignment) => assignment.count === 0).length,
  }
}