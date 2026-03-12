/**
 * TESSA Analysis placeholder.
 * TODO: Wire to the TESSA API when integration is ready.
 * The analysis engine exists as a separate service — this
 * function will POST the prelim PDF to it for automated
 * exception/requirement extraction.
 */
export async function analyzePrelim(documentId: number): Promise<void> {
  console.log(`[TESSA] Analysis queued for document ${documentId} — placeholder, no API call yet`);
}
