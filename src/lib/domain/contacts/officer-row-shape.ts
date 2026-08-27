/**
 * Shape validation for SoftPro officer lookup-table rows.
 *
 * ─── Why this is a shape check and not a value check ────────────────────────
 *
 * On 27 Aug 2026 the live `Escrow Officer` feed (GetLookuptable, production)
 * returned six rows. Five carried six keys:
 *
 *   Escrow officer/Closer, Office LookupCode, Officer Name, Email,
 *   Row State, LastModifiedAt
 *
 * One — `PCT\jgomez` — carried five: `Officer Name` empty, `Email` holding the
 * literal string "Unchanged", and `Row State` absent entirely. "Unchanged" is
 * the value every other row carries in `Row State`. The row is column-shifted:
 * a metadata value has landed in a data column and the trailing column has run
 * out of values.
 *
 * A guard that tested for `Email === 'Unchanged'` would catch that one row and
 * nothing else. A shift is not a bad value in a known field, it is a bad
 * mapping of values to fields — so the next shift, whose displaced value
 * happens to look like a plausible email, would pass such a guard and be
 * written as clean data. This module therefore validates the row against a
 * contract, so that misalignment is caught as a class:
 *
 *   1. COMPLETENESS — every key a well-formed row carries must be present.
 *      A left shift exhausts the trailing column, so the last key disappears.
 *      This is what catches Gomez's missing `Row State`.
 *
 *   2. OCCUPANCY — the fields an officer row cannot meaningfully be missing
 *      (`Officer Name`, `Email`, `Office LookupCode`) must be non-empty.
 *      A shift leaves a hole where a value was consumed.
 *
 *   3. DOMAIN — each field's value must belong to that field's domain: an
 *      email contains `@`, a branch code is a short alphanumeric token, a
 *      person's name is not an email address, and no data column may hold a
 *      `Row State` sentinel. This is the part that generalises: wherever a
 *      shift lands, it moves a value into a field whose domain it does not
 *      belong to, and the mismatch is detected without knowing which column
 *      moved.
 *
 * ─── What this does NOT catch ──────────────────────────────────────────────
 *
 *   • Wrong-but-well-formed content. A feed that says `Office LookupCode =
 *     "OCT"` for an officer who actually works out of `GLT` is perfectly
 *     shaped, and this guard passes it. Shape is not truth.
 *   • A shift between two fields with overlapping domains — two free-text
 *     columns swapping, or two short-code columns swapping — is invisible
 *     here, because every field still holds a domain-valid value.
 *   • An officer who silently stops appearing on the feed at all. That is
 *     absence, not misalignment, and nothing in this module sees it.
 *   • A new, unknown `Row State` sentinel leaking into a data column. Only
 *     the sentinels listed below are recognised as metadata; an unrecognised
 *     one would have to be caught by the domain tests instead.
 *
 * It will also reject a row if SoftPro legitimately renames or removes a
 * column. That is the deliberate trade: a loud rejection that a human can
 * escalate, over a silent write of misaligned data.
 */

/** The `Row State` values SoftPro emits. A data column holding one of these is misaligned. */
const ROW_STATE_SENTINELS = new Set(['unchanged', 'added', 'modified', 'deleted', 'detached']);

/** Branch/office codes observed in production: OCT, PRV, GLT, ONT. */
const OFFICE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,15}$/;

export interface OfficerRowFields {
  /** Key holding the `PCT\user` login code — differs between the escrow and title feeds. */
  code: string;
  officeLookupCode: string;
  officerName: string;
  email: string;
  rowState: string;
}

export const ESCROW_OFFICER_ROW_FIELDS: OfficerRowFields = {
  code: 'Escrow officer/Closer',
  officeLookupCode: 'Office LookupCode',
  officerName: 'Officer Name',
  email: 'Email',
  rowState: 'Row State',
};

export type OfficerRowShapeResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

function isSentinel(value: string): boolean {
  return ROW_STATE_SENTINELS.has(value.trim().toLowerCase());
}

/**
 * True when the row's values are aligned with its columns.
 *
 * Returns every reason it failed rather than the first, because a shifted row
 * usually violates several parts of the contract at once and the full list is
 * what tells a human at SoftPro which column moved.
 */
export function validateOfficerRowShape(
  row: Record<string, string>,
  fields: OfficerRowFields = ESCROW_OFFICER_ROW_FIELDS,
): OfficerRowShapeResult {
  const reasons: string[] = [];
  const raw = (key: string): string | undefined => row[key];
  const val = (key: string): string => (row[key] ?? '').trim();

  // 1. COMPLETENESS — a left shift exhausts the trailing column.
  for (const key of [fields.code, fields.officeLookupCode, fields.officerName, fields.email, fields.rowState]) {
    if (raw(key) === undefined) {
      reasons.push(`column '${key}' is absent from the row`);
    }
  }

  // 2. OCCUPANCY — a shift leaves a hole where a value was consumed.
  for (const key of [fields.code, fields.officeLookupCode, fields.officerName, fields.email]) {
    if (raw(key) !== undefined && val(key) === '') {
      reasons.push(`column '${key}' is present but empty`);
    }
  }

  // 3. DOMAIN — a value sitting in a field it cannot belong to.
  const office = val(fields.officeLookupCode);
  const name = val(fields.officerName);
  const email = val(fields.email);

  for (const [key, value] of [
    [fields.officeLookupCode, office],
    [fields.officerName, name],
    [fields.email, email],
  ] as const) {
    if (value !== '' && isSentinel(value)) {
      reasons.push(`column '${key}' holds the Row State sentinel ${JSON.stringify(value)}`);
    }
  }

  if (email !== '' && (!email.includes('@') || /\s/.test(email))) {
    reasons.push(`column '${fields.email}' does not hold an email address (${JSON.stringify(email)})`);
  }
  if (office !== '' && !OFFICE_CODE_PATTERN.test(office)) {
    reasons.push(`column '${fields.officeLookupCode}' does not hold a branch code (${JSON.stringify(office)})`);
  }
  if (name !== '' && name.includes('@')) {
    reasons.push(`column '${fields.officerName}' holds an email address (${JSON.stringify(name)})`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** One sentence naming the officer and saying the row was declined for shape. */
export function describeOfficerRowRejection(code: string, reasons: string[]): string {
  return `officer feed row for ${code} REJECTED for shape (not imported): ${reasons.join('; ')}`
    + '. A column-shifted vendor row cannot be repaired here — inferring the correct alignment'
    + ' would write plausible-looking wrong data. Escalate to SoftPro.';
}
