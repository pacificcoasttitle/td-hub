// ─── Why an order got no title documents ────────────────────────────────────
//
// `create-order.ts` reached TitlePoint through a three-way condition:
//
//     } else if (input.property.address && input.property.state && county) {
//
// ANY of the three missing skipped TitlePoint entirely, and the `else` did not
// exist — the order was created, no searches ran, no document was generated,
// and nothing anywhere said why. The order simply had no documents.
//
// MEASURED, 7 days of live hub orders (cancelled files excluded, because five
// cancelled orphans from the 2026-08-31 incident inflated an earlier count):
//
//     live hub orders          27
//     with no county            4
//     with no TitlePoint        4      the same four
//
// 15% of live orders lost every title document, silently.
//
// ─── COUNTY IS ONE DOOR, NOT THE DOOR ──────────────────────────────────────
//
// A required county field on the form is the right entrance to close, and it is
// being closed. It is not the fix. County has two sources —
//
//     const county = input.property.county ?? sitexData?.county ?? '';
//
// — and the SiteX call that feeds the second one is wrapped in
// `catch { /* SiteX failure never blocks order creation */ }`, so a SiteX
// outage, a no-match and a multi-match all empty it just as effectively as an
// operator leaving the field blank. Address and state are two more doors into
// the same hole.
//
// So this module names what was missing and the caller records it. The form
// field stops the common case; the recorded reason is what stops the next
// silent skip arriving through a door nobody was watching.

export type TitlePointInput = 'address' | 'state' | 'county';

export interface TitlePointPreconditionInput {
  address?: string | null;
  state?: string | null;
  county?: string | null;
}

/**
 * The TitlePoint inputs this order does not have, in a fixed order so the
 * recorded reason is stable and groupable.
 *
 * Empty means every precondition is satisfied and the searches can run.
 */
export function missingTitlePointInputs(
  input: TitlePointPreconditionInput,
): TitlePointInput[] {
  const missing: TitlePointInput[] = [];
  if (!(input.address ?? '').trim()) missing.push('address');
  if (!(input.state ?? '').trim()) missing.push('state');
  if (!(input.county ?? '').trim()) missing.push('county');
  return missing;
}

/**
 * The sentence written to `order_status_history.notes`.
 *
 * Written for the operator looking at one order and asking why it has no
 * documents, not for a log parser — it names the fields and says what to do.
 */
export function describeMissingTitlePointInputs(missing: TitlePointInput[]): string {
  if (missing.length === 0) return '';

  const LABEL: Record<TitlePointInput, string> = {
    address: 'property address',
    state: 'property state',
    county: 'property county',
  };
  const names = missing.map((m) => LABEL[m]);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return `No title documents: TitlePoint needs the ${list}, `
    + `which ${missing.length === 1 ? 'is' : 'are'} missing on this order. `
    + 'Add it on the order and the searches can be re-run.';
}
