// ─── What the confirmation says about documents ─────────────────────────────
//
// ONE EMAIL. The order confirmation is always sent. Documents are attached when
// they exist, and when something is still coming the body says so. There is no
// second email type and no document-delivery template — a customer receiving
// two messages titled "Confirmation" for one file reads it as a system error.
//
// ─── "OUTSTANDING" IS NOT "MISSING" ────────────────────────────────────────
//
// The distinction this module exists to make:
//
//   A missing GRANT DEED because the Legal & Vesting returned no qualifying
//   deed is NOT outstanding. Nothing is coming. Telling the customer we will
//   send it separately is a promise nobody can keep — the same defect as the
//   deliverable-emails helper text that promised documents nothing read.
//
//   A missing LEGAL & VESTING because the search failed IS outstanding. That
//   customer should be told, and Pacific Coast Title sends it by hand.
//
// Both are "partial" if you only count attachments. Only one is a promise we
// can keep. `OPTIONAL_DOC_TYPES` already carried the distinction — it is the
// same list that stops a grant deed gating the confirmation — so this reads it
// rather than inventing a second rule that can drift from it.
//
// Zero documents attached is not the rule; it is the common case OF the rule.
// On the current book it is 9 of 40 hub orders, all of them missing a county so
// no search ever ran, so every non-optional document is outstanding.

/** Docs that may attach when present — never gate the confirmation (legacy). */
export const CONFIRMATION_OPTIONAL_DOC_TYPES = ['grant_deed'] as const;

/** Every document category the confirmation can carry, in the order it lists them. */
export const CONFIRMATION_DOC_TYPES = ['legal_vesting', 'tax', 'grant_deed'] as const;

export type ConfirmationDocType = (typeof CONFIRMATION_DOC_TYPES)[number];

/** Customer-facing names. These appear in an email, so they are not slugs. */
export const CONFIRMATION_DOC_LABELS: Record<ConfirmationDocType, string> = {
  legal_vesting: 'Legal and Vesting',
  tax: 'Tax Roll',
  grant_deed: 'Recent Grant Deed',
};

function isOptional(t: string): boolean {
  return (CONFIRMATION_OPTIONAL_DOC_TYPES as readonly string[]).includes(t);
}

/**
 * Is a document the customer should be told about still to come?
 *
 * True when a NON-OPTIONAL document is not attached. False when everything
 * non-optional is present, whatever is missing from the optional list.
 */
export function hasOutstandingDocuments(attachedCategories: readonly string[]): boolean {
  const attached = new Set(attachedCategories);
  return CONFIRMATION_DOC_TYPES.some((t) => !isOptional(t) && !attached.has(t));
}

/**
 * The one sentence a customer reads when something is still coming.
 *
 * No count, no names, no timeframe — deliberately. When nothing has been
 * generated we do not yet know which documents will be produced, so naming
 * three specific ones promises three specific ones. There is no measured
 * turnaround to honour either, and an unkept "within 24 hours" is worse than no
 * promise at all. "will send" states what happens; it is not an apology.
 *
 * ─── THIS SENTENCE WAS A LIE FOR THE WHOLE OF ITS LIFE ──────────────────────
 *
 * It said Pacific Coast Title "will send the title documents separately", and
 * nothing did. No follow-up existed in code, and Gerard confirmed none existed
 * in anyone's routine either — 60 of 244 confirmations over 90 days carried
 * this sentence and no documents ever followed.
 *
 * It is true now because `outstanding-documents-alert.ts` tells the team what
 * to send and to whom, the moment the document lands. **The sentence and that
 * alert are one feature.** If the alert is ever disabled in Admin, this goes
 * back to being a promise nothing keeps — do not turn one off and leave the
 * other on.
 *
 * "our team" over "Pacific Coast Title" is the point of the rewrite: a person
 * does this, and the customer should expect a person. "shortly" is supported —
 * the median outstanding document arrives 1.0 minutes after the confirmation
 * and the slowest on record took 6.6.
 */
export const OUTSTANDING_DOCUMENTS_SENTENCE =
  'Our team will send the remaining title documents for this property to you shortly.';
