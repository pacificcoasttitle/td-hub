'use client'

// ============================================================
// TESSA™ PDF Extraction
// Client-side PDF text extraction using PDF.js v3.11.174.
// Runs entirely in the browser — PDF never sent to storage.
//
// Version note: pinned to v3.11.174 — the same version the
// legacy PCT production site runs. V4+ has worker loading
// issues with Next.js bundlers. V3 .js worker file loads
// cleanly from cdnjs with no dynamic import complications.
// ============================================================

import * as pdfjsLib from 'pdfjs-dist'

// v3.11.174 — proven stable .js worker, exists on cdnjs, no mjs/bundler issues
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

const MAX_CHARS = 50000

export async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''
  const totalPages = pdf.numPages

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()

    let pageText = ''
    for (const item of textContent.items) {
      const chunk = (item as { str?: string; hasEOL?: boolean }).str || ''
      pageText += chunk
      if ((item as { hasEOL?: boolean }).hasEOL) {
        pageText += '\n'
      } else {
        pageText += ' '
      }
    }

    // Heuristic: force a newline before "NN. " bullets if they got flattened by the PDF
    pageText = pageText.replace(/(\s{2,})(\d{1,3})\.\s/g, '\n$2. ')
    fullText += pageText + '\n\n'
  }

  const trimmed = fullText.trim()

  if (trimmed.length < 100) {
    throw new Error(
      'Unable to extract sufficient text from PDF. The document may be image-based or corrupted.'
    )
  }

  return trimmed.length > MAX_CHARS ? trimmed.substring(0, MAX_CHARS) : trimmed
}
