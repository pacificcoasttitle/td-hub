import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contacts, orderParties } from '@/lib/db/schema';

// ─── Parties on an order, for display ───────────────────────────────────────
//
// 36,606 rows across 7,913 of 8,036 orders — 98.5% coverage, 4.6 per order.
// This is the best-populated thing the detail pane can show, which is why it
// earns the top row beside the order card rather than a strip at the bottom.
//
// TWO ROLES ARE DELIBERATELY NOT SHOWN, and they are the largest bucket in the
// table. 13,851 rows carry role 'other', and 99.3% of them are exactly two
// things per order: the title company (us) and the underwriter (Westcor,
// Commonwealth). party_role has no value for either, so the sync puts them in
// 'other'. Rendering them would print "Other · Pacific Coast Title Company"
// and "Other · Westcor" on nearly every order — two anonymous rows that say
// less than nothing.
//
// They are excluded until the enum can name them. See
// docs/tickets/PARTY_ROLE_OTHER_IS_TWO_MISSING_ROLES.md. The count of what was
// hidden is returned rather than dropped silently, so the pane can say so.

/** Display order. Not alphabetical — this is the order a title officer reads. */
const ROLE_LABELS: Record<string, string> = {
  buyer: 'Buyer',
  borrower: 'Borrower',
  seller: 'Seller',
  buyer_agent: 'Buyer agent',
  listing_agent: 'Listing agent',
  lender: 'Lender',
  lender_contact: 'Lender contact',
  escrow_company: 'Escrow company',
};

const ROLE_ORDER = Object.keys(ROLE_LABELS);

export interface OrderParty {
  id: number;
  role: string;
  /** Already resolved to something printable, or null if the row carries no name. */
  label: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface OrderPartiesResult {
  parties: OrderParty[];
  /**
   * Rows withheld because their role has no name yet. Reported, never dropped
   * quietly — a pane that shows 5 of 7 parties without saying so is lying by
   * omission on an order where someone is checking who is involved.
   */
  unnamedRoleCount: number;
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export async function getOrderParties(orderId: number): Promise<OrderPartiesResult> {
  const rows = await db
    .select({
      id: orderParties.id,
      role: orderParties.role,
      isPrimary: orderParties.isPrimary,
      externalName: orderParties.externalName,
      externalCompany: orderParties.externalCompany,
      externalEmail: orderParties.externalEmail,
      externalPhone: orderParties.externalPhone,
      contactFullName: contacts.fullName,
      contactCompany: contacts.companyName,
      contactEmail: contacts.email,
      contactPhone: contacts.phone,
    })
    .from(orderParties)
    .leftJoin(contacts, eq(contacts.id, orderParties.contactId))
    .where(eq(orderParties.orderId, orderId))
    .orderBy(asc(orderParties.id));

  let unnamedRoleCount = 0;
  const parties: OrderParty[] = [];

  for (const r of rows) {
    const label = ROLE_LABELS[r.role];
    if (!label) {
      unnamedRoleCount += 1;
      continue;
    }

    // A linked contact wins over the free-text copy: it is the record that
    // dedup and search operate on, and the external_* columns are a snapshot
    // taken whenever the party was written.
    const name = clean(r.contactFullName) ?? clean(r.externalName);
    const company = clean(r.contactCompany) ?? clean(r.externalCompany);

    // A row with neither a name nor a company cannot be shown as a party.
    if (!name && !company) continue;

    parties.push({
      id: r.id,
      role: r.role,
      label,
      name,
      company,
      email: clean(r.contactEmail) ?? clean(r.externalEmail),
      phone: clean(r.contactPhone) ?? clean(r.externalPhone),
      isPrimary: r.isPrimary ?? false,
    });
  }

  parties.sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.role);
    const rb = ROLE_ORDER.indexOf(b.role);
    if (ra !== rb) return ra - rb;
    // Primary first within a role, then stable by id.
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.id - b.id;
  });

  return { parties, unnamedRoleCount };
}
