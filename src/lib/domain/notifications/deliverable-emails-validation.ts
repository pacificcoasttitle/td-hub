// ─── Deliverable emails: the pure half ──────────────────────────────────────
//
// Validation and the ceiling, with NO database import, because the open-order
// form and the post-open editor both need them in the browser. Importing the
// server module from a client component pulls the `db` client into the bundle
// and fails the build — which is how this split came to exist.
//
// The rules that matter live next door in deliverable-emails.ts. This file is
// deliberately incapable of reading or writing anything.

/** Hard ceiling. Matches the form, and is re-checked server-side. */
export const MAX_DELIVERABLE_EMAILS = 5;

export interface DeliverableEmail {
  id: number;
  email: string;
  addedBy: string | null;
  addedAt: Date;
}

/**
 * Conservative, and deliberately not RFC 5322.
 *
 * A regex that accepts everything the RFC allows also accepts things no mail
 * server will route. This rejects a few exotic-but-legal addresses; the cost of
 * that is an operator retyping, against the cost of a silently undelivered
 * document.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidDeliverableEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  return e.length > 0 && e.length <= 320 && EMAIL.test(e);
}

/**
 * Validate and de-duplicate a submitted list.
 *
 * Returns the addresses to store and the ones rejected, so the caller can tell
 * the operator which line was wrong rather than failing the whole form.
 */
export function validateDeliverableEmails(raw: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const trimmed = (item ?? '').trim();
    if (trimmed === '') continue;           // blank rows are not errors
    const e = normalizeEmail(trimmed);
    if (!isValidDeliverableEmail(e)) { invalid.push(trimmed); continue; }
    if (seen.has(e)) continue;              // typed twice is not an error
    seen.add(e);
    if (valid.length < MAX_DELIVERABLE_EMAILS) valid.push(e);
  }

  return { valid, invalid };
}
