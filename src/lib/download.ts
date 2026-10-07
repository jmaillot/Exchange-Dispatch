import JSZip from 'jszip'
import type { ExportBundle } from './exchange'

/**
 * Assemblage du ZIP d'export, entièrement dans le navigateur.
 *
 * Aucun envoi : le ZIP est produit en mémoire à partir des fichiers déjà
 * générés localement, puis téléchargé via une URL d'objet créée et révoquée
 * aussitôt.
 */
export async function buildZip(files: readonly ExportBundle[]): Promise<Blob> {
  const zip = new JSZip()

  for (const file of files) {
    zip.file(file.fileName, file.content)
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

/** Déclenche le téléchargement d'un contenu texte. */
export function downloadText(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  triggerDownload(fileName, blob)
}

/** Déclenche le téléchargement d'un ZIP déjà assemblé. */
export function downloadZip(fileName: string, blob: Blob): void {
  triggerDownload(fileName, blob)
}

function triggerDownload(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Sans révocation, le blob reste en mémoire jusqu'au rechargement.
  URL.revokeObjectURL(url)
}

export const CSV_MIME = 'text/csv'
export const POWERSHELL_MIME = 'text/plain'