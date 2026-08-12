// Content gate for AUTO-delivered prelims.
//
// WHY THIS EXISTS. On 2026-08-11 an internal 111-page title-search bundle was
// auto-delivered to an external escrow officer as a "Preliminary Title Report".
// Nothing in the pipeline had ever looked at what the document WAS: SoftPro's
// GetAttachedDocuments returns bare URLs with no type metadata, so every
// attachment is ingested as category='prelim', and delivery picks the most
// recent one.
//
// DELIBERATELY NOT A FILENAME FILTER. The bad file was named `dnu_140209.pdf`,
// and "dnu" looks like DO NOT USE — but two other `dnu_`-prefixed files
// delivered in the same period were verified genuine CLTA prelims. The prefix
// is a SoftPro merge artifact, not a classification: filtering on it would have
// blocked two legitimate deliveries and still missed a wrong document under any
// other name. So this reads the CONTENT.
//
// FAILING IS NOT DROPPING. A document that fails routes to manual review
// (needsManualDelivery), never silently skipped and never silently sent.

/** A phrase that on its own identifies a preliminary title report. */
const STRONG_MARKERS: Array<{ id: string; rx: RegExp }> = [
  { id: 'preliminary_report', rx: /preliminary\s+(title\s+)?report/i },
  { id: 'clta_preliminary', rx: /clta\s+preliminary/i },
];

/**
 * Phrases typical of a prelim but individually weak — "Exceptions" and
 * "Legal Description" also appear in deeds and title-search bundles.
 */
const SUPPORTING_MARKERS: Array<{ id: string; rx: RegExp }> = [
  { id: 'schedule_b', rx: /schedule\s+b\b/i },
  { id: 'exceptions', rx: /\bexceptions?\b/i },
  { id: 'vesting', rx: /\bvesting\b|vested\s+in/i },
  { id: 'legal_description', rx: /legal\s+description/i },
  { id: 'effective_date', rx: /effective\s+date/i },
  { id: 'policy_of_title_insurance', rx: /policy\s+of\s+title\s+insurance/i },
  { id: 'title_to_said_estate', rx: /title\s+to\s+said\s+estate/i },
];

/**
 * Supporting markers needed when no strong marker is present.
 *
 * Three, not two: the delivered bundle contained deeds and judgments, which
 * carry "exceptions" and "legal description" language on their own. Verified
 * against the three known files — see prelim-content-check.test.ts.
 */
export const MIN_SUPPORTING_MARKERS = 3;

/**
 * Below this many characters the document is treated as having no usable text
 * rather than as failing on content. A pure-scan prelim is a real thing; it
 * needs a human, not a verdict.
 */
export const MIN_TEXT_CHARS = 40;

export type PrelimCheckReason =
  | 'passed_strong_marker'
  | 'passed_supporting_markers'
  | 'no_prelim_markers'
  | 'no_text_layer'
  | 'parse_failed';

export interface PrelimContentAssessment {
  passed: boolean;
  reason: PrelimCheckReason;
  /** Marker ids found, for the audit log. Never document content. */
  matched: string[];
  textChars: number;
}

/**
 * Pure assessment of extracted PDF text. Kept free of pdf-parse and I/O so the
 * rule itself is testable against fixture text.
 */
export function assessPrelimText(text: string | null | undefined): PrelimContentAssessment {
  const body = (text ?? '').trim();
  if (body.length < MIN_TEXT_CHARS) {
    return { passed: false, reason: 'no_text_layer', matched: [], textChars: body.length };
  }

  const strong = STRONG_MARKERS.filter((m) => m.rx.test(body)).map((m) => m.id);
  const supporting = SUPPORTING_MARKERS.filter((m) => m.rx.test(body)).map((m) => m.id);

  if (strong.length > 0) {
    return {
      passed: true,
      reason: 'passed_strong_marker',
      matched: [...strong, ...supporting],
      textChars: body.length,
    };
  }
  if (supporting.length >= MIN_SUPPORTING_MARKERS) {
    return {
      passed: true,
      reason: 'passed_supporting_markers',
      matched: supporting,
      textChars: body.length,
    };
  }
  return { passed: false, reason: 'no_prelim_markers', matched: supporting, textChars: body.length };
}

/** Pages parsed. The identifying header of a prelim is on page 1; a couple more absorbs cover sheets. */
export const CHECK_PAGE_LIMIT = 3;

/**
 * Extract text and assess. Never throws — an unparseable PDF is a manual-review
 * outcome, not an exception that breaks the delivery job.
 */
export async function checkPrelimPdf(buffer: Buffer): Promise<PrelimContentAssessment> {
  try {
    // Same import path the rest of the codebase uses: the package index performs
    // a debug-mode file read that fails in a serverless bundle.
    const pdfParse = (await import('pdf-parse/lib/pdf-parse')).default as unknown as
      (b: Buffer, o?: { max?: number }) => Promise<{ text?: string }>;
    const parsed = await pdfParse(buffer, { max: CHECK_PAGE_LIMIT });
    return assessPrelimText(parsed?.text);
  } catch {
    return { passed: false, reason: 'parse_failed', matched: [], textChars: 0 };
  }
}
