/**
 * Shape validation for SoftPro `Order Contact - Person` lookup-table rows.
 *
 * ─── Why ────────────────────────────────────────────────────────────────────
 *
 * On 2026-09-15 the first completed page of the resumable person sync carried
 * five rows whose values had moved several columns (`AasNarApp`, `AasNarApps`,
 * `AasNarApps1`, `AasNarApps9`, `AasNarAppsNew`): `Email` held a phone number,
 * `GenderID` held the email, `Address1` held the user type, `State` held the
 * city and `Zip` held the state. They did not import only because the email,
 * sitting in `GenderID`, was longer than `contacts.gender_id` (varchar(10)).
 * That is an accident, not a defence — a shifted row whose values happen to fit
 * would be written as clean data.
 *
 * Officer rows already get a shape contract (`officer-row-shape.ts`). This is
 * the same idea for person rows, deliberately narrower: the one rule the person
 * feed can be held to without rejecting legitimate people is that a non-empty
 * `Email` is an email. A person row is only imported when it has an email at
 * all (rows with none are skipped), so this checks the one field the import
 * depends on. The other checks add reasons for whoever escalates to SoftPro;
 * they only ever reject a row that has already failed the email rule or holds a
 * `Row State` sentinel in a data column.
 *
 * ─── What this does NOT catch ──────────────────────────────────────────────
 *
 *   • A shift that leaves an email-shaped value in `Email`.
 *   • Wrong-but-well-formed content. Shape is not truth.
 *
 * Rejected rows are recorded, not repaired: inferring the correct alignment
 * would write plausible-looking wrong data. Escalate to SoftPro.
 */

const ROW_STATE_SENTINELS = new Set(['unchanged', 'added', 'modified', 'deleted', 'detached']);

/** Data columns that must never hold a `Row State` value. */
const DATA_COLUMNS = ['FirstName', 'LastName', 'Email', 'Address1', 'City'] as const;

export type PersonRowShapeResult = { ok: true } | { ok: false; reasons: string[] };

const isEmailShaped = (v: string) => v.includes('@') && !/\s/.test(v);

export function validatePersonRowShape(row: Record<string, string | undefined>): PersonRowShapeResult {
  const val = (key: string) => (row[key] ?? '').trim();
  const reasons: string[] = [];

  const email = val('Email');
  if (email !== '' && !isEmailShaped(email)) {
    reasons.push(`column 'Email' does not hold an email address (${JSON.stringify(email)})`);
  }

  for (const key of DATA_COLUMNS) {
    const v = val(key);
    if (v !== '' && ROW_STATE_SENTINELS.has(v.toLowerCase())) {
      reasons.push(`column '${key}' holds the Row State sentinel ${JSON.stringify(v)}`);
    }
  }

  if (reasons.length === 0) return { ok: true };

  // Context for SoftPro, only on a row already rejected above.
  const gender = val('GenderID');
  if (gender.includes('@')) {
    reasons.push(`column 'GenderID' holds an email address (${JSON.stringify(gender)})`);
  }
  for (const key of ['FirstName', 'LastName'] as const) {
    if (val(key).includes('@')) reasons.push(`column '${key}' holds an email address`);
  }

  return { ok: false, reasons };
}

/** One sentence naming the contact and saying the row was declined for shape. */
export function describePersonRowRejection(code: string, reasons: string[]): string {
  return `person feed row for ${code} REJECTED for shape (not imported): ${reasons.join('; ')}`
    + '. A column-shifted vendor row cannot be repaired here — inferring the correct alignment'
    + ' would write plausible-looking wrong data. Escalate to SoftPro.';
}
