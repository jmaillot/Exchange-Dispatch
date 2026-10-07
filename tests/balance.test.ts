import { describe, expect, it } from 'vitest'
import { balanceMailboxes, toMailboxes, type Mailbox } from '@/lib/balance'
import { parseCsv } from '@/lib/parse'

function mailbox(index: number, sizeMb: number): Mailbox {
  return {
    index,
    email: `user${index}@exemple.fr`,
    sizeMb,
    row: { UserPrincipalName: `user${index}@exemple.fr`, MailboxSizeMB: String(sizeMb) },
  }
}

function mailboxesFromSizes(sizes: number[]): Mailbox[] {
  return sizes.map((size, index) => mailbox(index, size))
}

function names(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `DB0${i + 1}`)
}

describe('balanceMailboxes', () => {
  it('met tout dans une seule base quand N vaut 1', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([100, 250, 50]),
      databaseNames: names(1),
    })

    expect(summary.assignments).toHaveLength(1)
    expect(summary.assignments[0]?.count).toBe(3)
    expect(summary.totalMb).toBe(400)
    expect(summary.spreadMb).toBe(0)
    expect(summary.emptyDatabaseCount).toBe(0)
  })

  it('répartit sur 5 bases', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([900, 800, 700, 600, 500, 400, 300, 200, 100, 50]),
      databaseNames: names(5),
    })

    expect(summary.assignments).toHaveLength(5)
    expect(summary.assignments.every((assignment) => assignment.count === 2)).toBe(true)
    expect(summary.totalMb).toBe(4550)

    const loads = summary.assignments.map((assignment) => assignment.totalMb)
    expect(Math.max(...loads) - Math.min(...loads)).toBe(50)
    expect(summary.spreadMb).toBeCloseTo(50, 9)
  })

  it('isole la boîte énorme et égalise le reste', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([100000, 100, 90, 80, 70, 60, 50, 40]),
      databaseNames: names(3),
    })

    const loads = summary.assignments.map((assignment) => assignment.totalMb)
    // La boîte énorme est seule dans sa base : aucun mouvement ne peut
    // la réduire sans dégrader les deux autres.
    expect(summary.assignments.some((assignment) => assignment.count === 1 && assignment.totalMb === 100000)).toBe(true)
    // Les 7 autres boîtes sont réparties au plus juste : 490 au total,
    // donc 245 et 245 sur les deux bases restantes.
    const others = loads.filter((load) => load !== 100000)
    expect(others).toHaveLength(2)
    expect(Math.max(...others) - Math.min(...others)).toBeLessThanOrEqual(50)
  })

  it('donne le même résultat pour des tailles égales', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([500, 500, 500, 500]),
      databaseNames: names(2),
    })

    expect(summary.spreadMb).toBe(0)
    expect(summary.assignments.every((assignment) => assignment.totalMb === 1000)).toBe(true)
  })

  it('répartit quand il y a moins de boîtes que de bases', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([300, 200, 100]),
      databaseNames: names(5),
    })

    expect(summary.assignments).toHaveLength(5)
    expect(summary.emptyDatabaseCount).toBe(2)
    expect(summary.assignments.filter((a) => a.count > 0).map((a) => a.totalMb)).toEqual([
      300, 200, 100,
    ])
  })

  it('conserve le total et calcule la moyenne', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([10, 20, 30]),
      databaseNames: names(3),
    })

    expect(summary.totalMb).toBe(60)
    expect(summary.averageMb).toBe(20)
    // L'ordre des bases est celui demandé : DB01 prend 30, puis les
    // égalités vont à la base la plus légère, donc 20 puis 10.
    expect(summary.deviationMb).toEqual([10, 0, 10])
    expect(summary.spreadMb).toBe(20)
  })

  it('respecte l’ordre des bases demandé', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([10, 20, 30]),
      databaseNames: ['Alpha', 'Beta'],
    })

    expect(summary.assignments.map((assignment) => assignment.name)).toEqual(['Alpha', 'Beta'])
  })

  it('améliore LPT : le placement glouton est corrigé', () => {
    // LPT seul donne 800 / 700 / 300, écart 500. L'optimum est
    // 700 / 600 / 500 : la boîte de 500 ne s'ajoute proprement à aucune
    // autre (500 + 300 = 800), donc 600 partout est impossible.
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([500, 400, 300, 300, 300]),
      databaseNames: names(3),
    })

    expect(summary.spreadMb).toBe(200)
    expect(summary.assignments.map((assignment) => assignment.totalMb).sort((a, b) => b - a)).toEqual([
      700, 600, 500,
    ])
  })

  it('reste déterministe sur plusieurs exécutions', () => {
    const sizes = [812, 445, 991, 78, 1204, 333, 667, 55, 890, 102, 76, 512]

    const first = balanceMailboxes({ mailboxes: mailboxesFromSizes(sizes), databaseNames: names(5) })
    const second = balanceMailboxes({ mailboxes: mailboxesFromSizes(sizes), databaseNames: names(5) })

    const signature = (summary: typeof first) =>
      summary.assignments
        .map((assignment) => `${assignment.name}:${assignment.totalMb}:${assignment.mailboxes.map((m) => m.index).join('.')}`)
        .join('|')

    expect(signature(second)).toBe(signature(first))
  })

  it('départage les tailles égales par ordre du fichier', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([10, 10, 10, 10]),
      databaseNames: ['A', 'B'],
    })

    // LPT pose 0 dans A puis 1 dans B ; les égalités vont ensuite à la
    // base d'indice le plus bas, donc 2 revient dans A et 3 dans B.
    expect(summary.assignments[0]?.mailboxes.map((m) => m.index)).toEqual([0, 2])
    expect(summary.assignments[1]?.mailboxes.map((m) => m.index)).toEqual([1, 3])
  })

  it('trie chaque base par taille décroissante à l’export', () => {
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([10, 50, 30, 40, 20]),
      databaseNames: ['A', 'B'],
    })

    for (const assignment of summary.assignments) {
      const sizes = assignment.mailboxes.map((m) => m.sizeMb)
      expect(sizes).toEqual([...sizes].sort((x, y) => y - x))
    }
  })

  it('ne vide jamais une base pour améliorer le coût', () => {
    // Vider une base ferait chuter l'écart max-min : deux bases identiques
    // donneraient un écart de zéro. L'optimisation doit refuser ce raccourci.
    const summary = balanceMailboxes({
      mailboxes: mailboxesFromSizes([500, 400, 300]),
      databaseNames: names(3),
    })

    expect(summary.emptyDatabaseCount).toBe(0)
    expect(summary.assignments.map((assignment) => assignment.totalMb).sort((a, b) => b - a)).toEqual([
      500, 400, 300,
    ])
  })

  it('gère un CSV vide', () => {
    const summary = balanceMailboxes({ mailboxes: [], databaseNames: names(3) })

    expect(summary.totalMb).toBe(0)
    expect(summary.emptyDatabaseCount).toBe(3)
    expect(summary.spreadMb).toBe(0)
  })
})

describe('balanceMailboxes sur la fixture complète', () => {
  it('équilibre 10 boîtes réelles fictives sur 3 bases', () => {
    const parsed = parseCsv(
      'UserPrincipalName,MailboxSizeMB\n' +
        'a@exemple.fr,1840.5\n' +
        'b@exemple.fr,1520\n' +
        'c@exemple.fr,990.25\n' +
        'd@exemple.fr,760\n' +
        'e@exemple.fr,610.75\n' +
        'f@exemple.fr,430\n' +
        'g@exemple.fr,295.5\n' +
        'h@exemple.fr,180\n' +
        'i@exemple.fr,95\n' +
        'j@exemple.fr,42.5',
    )

    const mailboxes = toMailboxes(parsed.rows, 'MailboxSizeMB', 'UserPrincipalName')
    expect(mailboxes).toHaveLength(10)

    const summary = balanceMailboxes({ mailboxes, databaseNames: ['DB01', 'DB02', 'DB03'] })

    // 1840,5 + 1520 + 990,25 + 760 + 610,75 + 430 + 295,5 + 180 + 95 + 42,5
    expect(summary.totalMb).toBeCloseTo(6764.5, 6)
    expect(summary.assignments).toHaveLength(3)
    expect(summary.assignments.every((assignment) => assignment.count > 0)).toBe(true)

    const loads = summary.assignments.map((assignment) => assignment.totalMb)
    // Moyenne 2254,8 Mo. L'optimum sur cette distribution est 49 Mo
    // (2231 / 2280 / 2253,5) : aucun découpage n'atteint l'égalité.
    expect(summary.spreadMb).toBe(49)
    expect(Math.max(...loads)).toBe(2280)
    expect(Math.min(...loads)).toBe(2231)
  })
})