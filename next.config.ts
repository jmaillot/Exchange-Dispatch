import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // L'application est intégralement côté client : les données du CSV ne
  // doivent jamais atteindre un serveur. `output: 'export'` rend cette
  // contrainte vérifiable par construction — le build ne produit qu'un
  // dossier de fichiers statiques.
  output: 'export',
  reactStrictMode: true,
}

export default nextConfig