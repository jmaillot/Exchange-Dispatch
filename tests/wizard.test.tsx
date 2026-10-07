import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Wizard } from '@/components/Wizard'

describe('Wizard', () => {
  it('affiche la première étape et la navigation', () => {
    render(<Wizard />)

    expect(screen.getByRole('heading', { name: 'Exchange DB Balancer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Choisir un fichier CSV/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /charger l’exemple/i })).toBeInTheDocument()

    // Toutes les étapes sont visibles, mais seule la première est active.
    expect(screen.getByRole('button', { name: /1\. Import/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /6\. Export/ })).toBeDisabled()
  })
})