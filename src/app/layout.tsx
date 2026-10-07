import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Exchange DB Balancer',
  description:
    "Répartit des boîtes aux lettres Exchange Server sur plusieurs bases de destination de taille la plus proche possible, puis génère les CSV de batch et les commandes PowerShell de migration.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}