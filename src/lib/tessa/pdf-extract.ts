import pdf from 'pdf-parse/lib/pdf-parse';

const MAX_CHARS = 50_000;
const MIN_CHARS = 100;

/**
 * Extract text from a PDF buffer. Server-side, Node.js compatible.
 * Uses pdf-parse which handles all Node.js/pdfjs compatibility internally.
 *
 * Matches the pct.com extraction behavior:
 * - 50,000 character cap
 * - Newline re-insertion before numbered items
 * - Minimum 100 char threshold (rejects image-only PDFs)
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const data = await pdf(pdfBuffer);
  let text = data.text;

  if (!text || text.length < MIN_CHARS) {
    throw new Error(
      `Extracted text too short (${text?.length ?? 0} chars) — ` +
      'PDF may be image-based or corrupted',
    );
  }

  text = text.replace(/(?<!\n)(\d{1,3}\.\s)/g, '\n$1');

  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS);
  }

  return text;
}
