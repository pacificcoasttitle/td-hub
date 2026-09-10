/**
 * WHAT IS THIS DOCUMENT? Answered positively, from evidence only one type
 * carries — never by counting vocabulary several types share, and never from
 * the filename.
 *
 * WHY THIS REPLACES prelim-content-check.ts
 *
 * That check asked "does this look like title paperwork?" by counting seven
 * supporting markers — `schedule b`, `exceptions`, `vesting`, `legal
 * description`, `effective date`, `policy of title insurance`, `title to said
 * estate` — and passing anything with three. Every document in an escrow file
 * has that vocabulary. An ALTA title policy carries four of them unaided.
 *
 * Between 2026-08-01 and 2026-09-02 that let ten documents out as preliminary
 * title reports, two of them internal Order Summaries sent to outside escrow
 * companies. See docs/tickets/PRELIM_DELIVERED_THE_WRONG_DOCUMENT.md.
 *
 * Filenames are not evidence either. Of the six `dnu_` files delivered, four
 * were genuine prelims; the two that were not were named identically. And
 * SoftPro names lender documents "Loan Policy", never "Lender's Policy", so a
 * filename substring rule sends a lender's document to the property owner.
 *
 * MEASURED 2026-09-10 over every policy, supplement and `dnu_` document we
 * hold plus a control set of normally-named prelims. Each type opens with a
 * phrase no other type uses, and does so with complete consistency.
 */

export type DocumentType =
  | 'clta_preliminary_report'
  | 'alta_loan_policy'
  | 'alta_owners_policy'
  | 'supplement_statement'
  | 'order_summary'
  | 'closing_protection_letter'
  | 'proposed_insured_letter'
  | 'unidentified';

export type UnidentifiedReason =
  | 'no_extractable_text'
  | 'no_signature_matched'
  | 'multiple_signatures_matched';

export interface DocumentIdentity {
  type: DocumentType;
  /** The phrase that identified it. Empty when unidentified. */
  matchedOn: string;
  /** Set only when `type` is 'unidentified'. */
  reason?: UnidentifiedReason;
  /** Every signature that matched — more than one means we refuse. */
  candidates: DocumentType[];
  textChars: number;
  /**
   * Has this signature ever matched a real document?
   *
   * FALSE means the pattern was written from a form-naming convention and has
   * never been confirmed against a file we actually received. A caller that is
   * about to email a legal document to a named individual MUST treat an
   * unvalidated identification as a refusal — being probably right about who
   * owns a property is not good enough.
   *
   * This is a field rather than a comment because a comment does not stop a
   * send.
   */
  validated: boolean;
}

/**
 * Signatures that have never matched a real document.
 *
 * Empty as of 2026-09-10. `alta_owners_policy` was here until a real Owner's
 * Policy Jacket was pulled from `GetAttachedDocumentsPolicy?DocType=Owner` and
 * the signature confirmed against it.
 *
 * The earlier conclusion that owner's policies were never attached to SoftPro
 * orders was wrong, and wrong for a specific reason: the corpus was searched
 * and two document endpoints were probed, but the documented endpoint that
 * actually serves policies was never called. Absence of evidence was reported
 * as evidence of absence.
 *
 * Add a type here whenever a signature is written from a form convention
 * rather than from a document in hand, and remove it only after a real one has
 * been seen.
 */
export const UNVALIDATED_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([]);

/**
 * Below this, the PDF is image-only or corrupt and there is nothing to read.
 * The TitlePoint `tp_*` documents extract 4–30 characters; they are scans.
 */
export const MIN_TEXT_CHARS = 400;

interface Signature {
  type: DocumentType;
  /** A phrase THIS type has and no other type does. */
  rx: RegExp;
  label: string;
  /**
   * How far into the document the phrase may appear.
   *
   * THIS IS THE WHOLE MECHANISM, and it was learned the hard way. The first
   * version matched anywhere in the text and refused 31 of 40 GENUINE prelims
   * as `multiple_signatures_matched`, because a preliminary report's body
   * names the ALTA policy forms that will be issued from it. Searching the
   * whole document finds every type mentioned in it; searching the opening
   * finds the type it IS.
   *
   * Each document announces itself in its first line or two. Beyond that
   * window a phrase is a reference to another document, not a claim about
   * this one.
   */
  window: number;
}

/**
 * Order matters only for readability — every signature is evaluated, and two
 * matches is a refusal rather than a first-wins guess.
 */
const SIGNATURES: Signature[] = [
  {
    // Verbatim on every prelim sampled, including the four `dnu_` files and
    // the "Revised 1" and "Recording Package" files that really were prelims.
    type: 'clta_preliminary_report',
    rx: /CLTA\s+Preliminary\s+Report\s+Form/i,
    label: 'CLTA Preliminary Report Form',
    // Character 0 of page 1 on every prelim measured.
    window: 200,
  },
  {
    // The internal document that reached two outside escrow companies. It
    // opens with this and nothing else does.
    type: 'order_summary',
    rx: /Order\s+Summary\s+Document\s+generated\s*:/i,
    label: 'Order Summary Document generated:',
    window: 200,
  },
  {
    // ALTA policies name their own form, in caps, repeatedly — 4 to 7 times in
    // every policy we hold. "Loan", never "Lender".
    type: 'alta_loan_policy',
    rx: /\bLP-\d{2,3}\b|Loan\s+Policy\s+of\s+Title\s+Insurance|(?:ALTA|OCT)[A-Z\s]{0,60}\bLOAN\s+POLICY\b|ALTA\s+Residential\s+Limited\s+Coverage\s+Junior\s+Loan\s+Policy/i,
    label: 'LP-NNN / Loan Policy of Title Insurance (self-named ALTA form)',
    // The form names itself right after the ALTA copyright block. Measured at
    // offset 150-700 across every policy we hold.
    window: 1200,
  },
  {
    // VALIDATED 2026-09-10 against a real Owner's Policy Jacket pulled from
    // GetAttachedDocumentsPolicy?DocType=Owner on 20018796-OCT.
    //
    // The first version of this pattern did not match it, for a reason worth
    // recording: the document uses a CURLY apostrophe. "ALTA OWNER’S POLICY OF
    // TITLE INSURANCE", U+2019, not U+0027. A pattern written from how the
    // phrase is spoken rather than how the file spells it matches nothing —
    // and it failed silently as `no_signature_matched`, which is safe but
    // wrong. Both forms are accepted now, and so is the ALTA form code, which
    // has no apostrophe to get wrong: OP-54 for an owner's policy against
    // LP-152 / LP-158 for a lender's.
    type: 'alta_owners_policy',
    rx: /\bOP-\d{2,3}\b|Owner[’']?s?\s+Policy\s+of\s+Title\s+Insurance|(?:ALTA|OCT)[A-Z\s]{0,60}\bOWNER[’']?S?\s+POLICY\b/i,
    label: 'OP-NNN / Owner’s Policy of Title Insurance (self-named ALTA form)',
    window: 1200,
  },
  {
    // Supplements open with the literal word followed by the order number.
    type: 'supplement_statement',
    rx: /^\s*Supplemental\s*\d{7,}-[A-Z]{2,4}/i,
    label: 'Supplemental<orderNumber>',
    window: 100,
  },
  {
    type: 'closing_protection_letter',
    rx: /American\s*Land\s*Title\s*Association\s*Closing\s*Protection\s*Letter/i,
    label: 'ALTA Closing Protection Letter',
    window: 300,
  },
  {
    type: 'proposed_insured_letter',
    rx: /Issuing\s+Agent\s+for\s+Westcor[\s\S]{0,400}?Proposed\s+Insured/i,
    label: 'Issuing Agent for Westcor … Proposed Insured',
    window: 900,
  },
];

/**
 * Identify a document from its extracted text.
 *
 * Returns 'unidentified' rather than a best guess. A caller that is about to
 * email a legal document to a named party must refuse on 'unidentified' — the
 * whole point is that not knowing is a valid and safe answer.
 */
export function identifyDocument(rawText: string): DocumentIdentity {
  const text = (rawText ?? '').replace(/\s+/g, ' ').trim();

  if (text.length < MIN_TEXT_CHARS) {
    return {
      type: 'unidentified',
      matchedOn: '',
      reason: 'no_extractable_text',
      candidates: [],
      textChars: text.length,
      validated: false,
    };
  }

  // Each signature is tested only against the opening of the document, sized
  // to where that type names itself. See Signature.window.
  const matched = SIGNATURES.filter((s) => s.rx.test(text.slice(0, s.window)));

  if (matched.length === 0) {
    return {
      type: 'unidentified',
      matchedOn: '',
      reason: 'no_signature_matched',
      candidates: [],
      textChars: text.length,
      validated: false,
    };
  }

  if (matched.length > 1) {
    // Two types claiming the same document means a signature is not as unique
    // as it was measured to be. Refusing is correct: the alternative is
    // picking one and being wrong about a legal document half the time.
    return {
      type: 'unidentified',
      matchedOn: '',
      reason: 'multiple_signatures_matched',
      candidates: matched.map((m) => m.type),
      textChars: text.length,
      validated: false,
    };
  }

  const type = matched[0]!.type;
  return {
    type,
    matchedOn: matched[0]!.label,
    candidates: [type],
    textChars: text.length,
    validated: !UNVALIDATED_TYPES.has(type),
  };
}

/**
 * May this document be sent to the type's intended recipient?
 *
 * Two ways to fail and both are refusals: we could not identify it, or we
 * identified it with a signature that has never matched a real document. The
 * caller routes a false to the internal alert, never to a substitute recipient.
 */
export function isSafeToDeliver(identity: DocumentIdentity, expected: DocumentType): boolean {
  return identity.type === expected && identity.validated;
}

/** Human-readable, for an operator message or an internal alert. */
export function describeDocumentType(type: DocumentType): string {
  switch (type) {
    case 'clta_preliminary_report': return 'Preliminary Title Report';
    case 'alta_loan_policy': return "Lender's Loan Policy";
    case 'alta_owners_policy': return "Owner's Policy";
    case 'supplement_statement': return 'Supplement Statement';
    case 'order_summary': return 'Order Summary (internal)';
    case 'closing_protection_letter': return 'Closing Protection Letter';
    case 'proposed_insured_letter': return 'Proposed Insured Letter';
    case 'unidentified': return 'Unidentified document';
  }
}
