// ============================================================
// TESSA™ PDF Text Extraction — Server-side (Node.js)
// Uses pdfjs-dist legacy build for Node.js compatibility.
// Ported from tessa-pdf.ts (client-side) with server adaptations.
// ============================================================

const MAX_CHARS = 50_000;

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  // Dynamic import of legacy build for Node.js (no web workers needed)
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(pdfBuffer);
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  let fullText = '';
  const totalPages = pdf.numPages;

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    let pageText = '';
    for (const item of textContent.items) {
      const chunk = (item as { str?: string; hasEOL?: boolean }).str || '';
      pageText += chunk;
      if ((item as { hasEOL?: boolean }).hasEOL) {
        pageText += '\n';
      } else {
        pageText += ' ';
      }
    }

    // Heuristic: force a newline before "NN. " bullets if they got flattened
    pageText = pageText.replace(/(\s{2,})(\d{1,3})\.\s/g, '\n$2. ');
    fullText += pageText + '\n\n';
  }

  const trimmed = fullText.trim();

  if (trimmed.length < 100) {
    throw new Error(
      'Unable to extract sufficient text from PDF. The document may be image-based or corrupted.',
    );
  }

  return trimmed.length > MAX_CHARS ? trimmed.substring(0, MAX_CHARS) : trimmed;
}
