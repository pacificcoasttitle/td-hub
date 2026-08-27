import { parseSiteXOwners } from '@/lib/domain/orders/names/sitex-owner-names';
import type { PartyRole } from './party-wizard-fields';

// ─── What the public page is allowed to know ─────────────────────────────────
//
// The wizard URL is forwarded by hand through inboxes we do not control, so
// every field here is one an unauthenticated stranger may read. The rule the
// owner set is narrow and worth restating where the code can be checked against
// it:
//
//   NEVER, for any role — loan amount, sales price, any financial term, any
//   other party's contact details, the lender, or anything about the order the
//   recipient would not already know from their own role.
//
// Nothing in this module reads those columns, and party-wizard-context.test.ts
// asserts they never reach the rendered page.
//
// This module is deliberately pure: the ladder and the name rules are the part
// most likely to be wrong, and they are worth testing without a database.

/**
 * A person the recipient can contact, resolved from the ladder below.
 *
 * There is no `title` and no extension because neither exists: `contacts.title`,
 * `contacts.phone_ext` and `contacts.cell` are empty on all 4,611 candidate
 * orders. A block that promises a direct line and renders nothing is worse than
 * one that never promised it.
 */
export interface WizardContact {
  name: string;
  /** Their employer, and only when it is not us. See `isPacificCoast`. */
  company: string | null;
  email: string;
  /** Present on roughly a third of orders. The block reads fine without it. */
  phone: string | null;
  /** Drives the label, since "escrow officer" and "title officer" are not interchangeable. */
  kind: 'escrow_officer' | 'title_officer';
}

/** Raw columns the ladder needs. Kept flat so the service can select straight into it. */
export interface WizardContactSource {
  escrowOfficerName: string | null;
  escrowOfficerEmail: string | null;
  escrowOfficerPhone: string | null;
  escrowOfficerCompany: string | null;
  titleOfficerName: string | null;
  titleOfficerEmail: string | null;
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * Is this one of ours?
 *
 * Matters because the escrow officer on an order is usually NOT a PCT employee:
 * on the 4,611 candidate orders, 551 sit on a `pct.com` address and 1,419 point
 * at an outside escrow company. Naming that company is the strongest legitimacy
 * signal the page has — the recipient knows Powerhouse Escrow even if they have
 * never heard of us — but printing "Pacific Coast Title" next to a PCT officer
 * is just noise, so the company line is suppressed for our own people.
 */
export function isPacificCoast(email: string | null, company: string | null): boolean {
  const domain = email?.trim().toLowerCase().split('@')[1] ?? '';
  if (domain === 'pct.com' || domain.endsWith('.pct.com') || domain.includes('pctitle')) return true;
  return /pacific\s*coast\s*title/i.test(company ?? '');
}

/**
 * A number worth printing.
 *
 * Production carries `000000000` and `000-000-0000` as escrow officer phones —
 * 66 of the 1,504 that are non-empty. On a page whose whole job is to look
 * legitimate, a placeholder phone number is actively worse than no phone, so
 * anything without ten real digits is dropped rather than shown.
 *
 * The number is never reformatted. It is stored the way a human typed it and
 * a formatting bug here would be indistinguishable from a wrong number.
 */
export function usablePhone(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (/^0+$/.test(digits)) return null;
  return value;
}

/**
 * The contact ladder.
 *
 * Escrow officer first: they are the person who forwarded the link, so they are
 * the one the recipient can place. Title officer second, because they are on
 * 96.2% of orders against the escrow officer's 42.7%. Both need an email to be
 * worth rendering — an unreachable name is not a contact.
 *
 * Returns null when nothing resolves, which the block renders as a single line
 * pointing back at the email rather than as an empty card.
 *
 * A sales rep tier was considered and declined by the owner, which is why phone
 * coverage stops at roughly a third. The block is built so that reads as normal.
 */
export function resolveWizardContact(source: WizardContactSource): WizardContact | null {
  const escrowName = clean(source.escrowOfficerName);
  const escrowEmail = clean(source.escrowOfficerEmail);
  if (escrowName && escrowEmail) {
    const company = clean(source.escrowOfficerCompany);
    return {
      name: escrowName,
      company: isPacificCoast(escrowEmail, company) ? null : company,
      email: escrowEmail,
      phone: usablePhone(source.escrowOfficerPhone),
      kind: 'escrow_officer',
    };
  }

  const titleName = clean(source.titleOfficerName);
  const titleEmail = clean(source.titleOfficerEmail);
  if (titleName && titleEmail) {
    return {
      name: titleName,
      company: null,
      email: titleEmail,
      // 3.9% fill. Not worth a column of its own, and never promised.
      phone: null,
      kind: 'title_officer',
    };
  }

  return null;
}

// ─── The counterpart name ────────────────────────────────────────────────────

/**
 * Words that mean the owner is not a person.
 *
 * The positional flip that turns "SANCHEZ SERGIO T" into "Sergio T Sanchez" has
 * no idea what to do with "PACIFIC TRUST LLC", and produces "Trust Llc Pacific".
 * Rendering that under "Representing" would undo the entire point of the page,
 * so an entity owner produces no line at all.
 */
const ENTITY_WORDS = /\b(INC|LLC|L\.L\.C|LP|LLP|LTD|TRUST|CORP|CORPORATION|COMPANY|CO|FOUNDATION|PARTNERSHIP|PARTNERS|ASSN|ASSOCIATION|BANK|HOLDINGS|PROPERTIES|GROUP|ESTATE|FAMILY|REVOCABLE|LIVING|SURVIVOR|ET\s?AL)\b/i;

/**
 * The name of the party on the recipient's own side of the file.
 *
 * Purpose is CONFIRMATION, not disclosure: a listing agent already knows who
 * their seller is, so seeing the name proves they are on the right file — and
 * if it is wrong they will say so, which is data-quality feedback available no
 * other way.
 *
 * Only `order_properties.primary_owner` is used, parsed through the shipped
 * SiteX owner parser. The SECOND owner is deliberately never rendered: it is
 * where the parse breaks down. "SALER JAMES R & MELISSA D" yields a correct
 * "James R Saler" and a mangled "D Melissa", and 8.7% of second seller rows in
 * production begin with a stray initial like that.
 *
 * Returns null far more often than it returns a name — 61.4% of invite
 * candidates are refinances with no seller at all. Absent is the designed
 * outcome, not a degraded one.
 */
export function resolveCounterpartName(
  role: PartyRole,
  primaryOwner: string | null | undefined,
): string | null {
  // Only the listing agent can be invited today, and their counterpart is the
  // seller. Any other role gets nothing until it has a form of its own.
  if (role !== 'listing_agent') return null;

  const raw = clean(primaryOwner);
  if (!raw) return null;
  if (ENTITY_WORDS.test(raw)) return null;

  const { primary } = parseSiteXOwners(raw);
  if (!primary) return null;

  const first = clean(primary.firstName);
  const last = clean(primary.lastName);
  // A single token parses as a surname with no given name. "Representing Saler"
  // is not a confirmation of anything.
  if (!first || !last) return null;

  return [first, clean(primary.middleName), last].filter(Boolean).join(' ');
}

/** How the counterpart is described to this role. */
export function counterpartLabel(role: PartyRole): string {
  return role === 'listing_agent' ? 'Representing' : 'On file for';
}

// ─── Link state ──────────────────────────────────────────────────────────────

/**
 * Revoked and expired collapse to ONE outcome.
 *
 * The page used to carry separate copy for the two — "This link has been
 * withdrawn" against "This link has expired" — which told anyone reading it
 * that a real link existed and that somebody had deliberately pulled it. The
 * comment on resolvePartyWizardLink has always said failures should be
 * indistinguishable; this is that intent applied to the two states that were
 * still leaking.
 *
 * Kept pure and separate from the query so both branches are testable without
 * a database.
 */
export function classifyLinkState(
  row: { revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): 'active' | 'inactive' {
  if (row.revokedAt) return 'inactive';
  if (row.expiresAt.getTime() <= now.getTime()) return 'inactive';
  return 'active';
}
