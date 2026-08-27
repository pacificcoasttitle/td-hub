import { isValidEmail, normalizeEmail } from '@/lib/domain/notifications/prelim-recipient-resolution';
import type { PartyWizardAudience } from './party-wizard-email';

// ─── Who the invite is addressed to ──────────────────────────────────────────
//
// The invite job used `orders.escrow_officer_id` and nothing else, so an order
// without that FK was simply unreachable — 3,715 of 3,715 unreachable candidates
// in the 41-day measurement, and 88.5% of all candidates.
//
// The escrow_company PARTY ROW carries an address on most of those files, and
// resolvePrelimRecipients has been reading it for exactly this reason since the
// prelim delivery work. The pattern was already solved in our own code; this job
// just never had it. THE PRECEDENCE HERE IS DELIBERATELY THE SAME AS THAT
// RESOLVER'S — officer FK first, then the party row's external_email, then the
// party row's linked contact — so that two emails about the same order do not
// arrive at two different addresses.
//
// The validity and normalisation helpers are imported from that resolver rather
// than reimplemented, so the two cannot drift on what counts as an address.

export type InviteRecipientRole = 'escrow_officer' | 'escrow_company';

export interface InviteRecipient {
  email: string;
  name: string | null;
  /** The outside firm, when the party row names one. */
  company: string | null;
  /** Which lookup found them. Reported in the dry run. */
  role: InviteRecipientRole;
  /** Which copy variant they get. NOT the same question as `role` — see below. */
  audience: PartyWizardAudience;
}

/** The raw columns the candidate query carries for one order. */
export interface InviteRecipientSources {
  officerId: number | null;
  officerName: string | null;
  officerEmail: string | null;
  /** order_parties row with role='escrow_company'. */
  companyExternalEmail: string | null;
  companyExternalName: string | null;
  companyExternalCompany: string | null;
  companyContactEmail: string | null;
  companyContactName: string | null;
}

/**
 * PCT-internal, by email domain.
 *
 * Mirrors the email arm of `internalContactFilter` in contacts/filters.ts, which
 * is the codebase's existing definition of internal. That filter has a second
 * arm — an existing `profiles` row — which cannot apply here: an escrow_company
 * party row often has no contact row at all, so there is nothing to join a
 * profile to. The domain test is the part that generalises.
 *
 * WHY THIS IS NOT KEYED ON `role`. It is tempting to assume officer FK means
 * colleague and party row means outsider. It does not. Only 701 of the 3,842
 * orders with an escrow_officer_id point at a `@pct.com` address — 18.2% — and
 * the other 81.8% are outside firms recorded as the officer. In the other
 * direction, 118 escrow_company party rows carry `@pct.com` addresses. Choosing
 * the copy variant by lookup source would send colleague copy to thousands of
 * outside firms and stranger copy to PCT staff.
 */
export function isInternalRecipientEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith('@pct.com');
}

/**
 * Resolve one order's invite recipient, or null when nobody is reachable.
 *
 * Pure. The candidate query does the fetching in one pass, so a 100-order batch
 * costs one query rather than the per-order round trip the prelim resolver makes
 * — that resolver runs on a single order at a time and can afford it.
 */
export function pickInviteRecipient(src: InviteRecipientSources): InviteRecipient | null {
  if (src.officerId !== null && isValidEmail(src.officerEmail)) {
    const email = normalizeEmail(src.officerEmail);
    return {
      email,
      name: src.officerName,
      company: null,
      role: 'escrow_officer',
      audience: isInternalRecipientEmail(email) ? 'internal' : 'external',
    };
  }

  const companyEmail = isValidEmail(src.companyExternalEmail)
    ? src.companyExternalEmail
    : src.companyContactEmail;

  if (!isValidEmail(companyEmail)) return null;

  const email = normalizeEmail(companyEmail);
  return {
    email,
    name: src.companyContactName ?? src.companyExternalName,
    company: src.companyExternalCompany,
    role: 'escrow_company',
    audience: isInternalRecipientEmail(email) ? 'internal' : 'external',
  };
}
