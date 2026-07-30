// Client classification for My Clients. ONE derived dimension — not a tagging
// system. Values mirror the DB CHECK constraint in migration 0033.

export const CRM_CLIENT_TYPES = ['agent', 'lender', 'escrow', 'title', 'other'] as const;

export type CrmClientType = typeof CRM_CLIENT_TYPES[number];

export function isCrmClientType(v: unknown): v is CrmClientType {
  return typeof v === 'string' && (CRM_CLIENT_TYPES as readonly string[]).includes(v);
}

/** Human labels, singular (badge) and plural (filter). */
export const CRM_TYPE_LABEL: Record<CrmClientType, string> = {
  agent: 'Agent',
  lender: 'Lender',
  escrow: 'Escrow',
  title: 'Title',
  other: 'Other',
};

export const CRM_TYPE_LABEL_PLURAL: Record<CrmClientType, string> = {
  agent: 'Agents',
  lender: 'Lenders',
  escrow: 'Escrow',
  title: 'Title',
  other: 'Other',
};

/**
 * Maps a transaction party role to a client type.
 *
 * Consumer roles (buyer/seller/borrower) never reach here — they're excluded
 * from the seed upstream (CONSUMER_PARTY_ROLES). Anything else that is a
 * business source but not specifically recognised classifies as 'other'.
 *
 * Returns null for roles we deliberately refuse to classify, so callers can
 * leave the client unclassified rather than guessing.
 */
export function partyRoleToClientType(role: string): CrmClientType | null {
  switch (role) {
    case 'listing_agent':
    case 'buyer_agent':
      return 'agent';
    case 'lender':
    case 'lender_contact':
      return 'lender';
    case 'escrow_company':
      return 'escrow';
    case 'title_company':
    case 'title_officer':
      return 'title';
    // 'client' is a relationship, not a business category — it says the person
    // is on the order, not what kind of business they are. Leave unclassified
    // so a more specific role on another order can win.
    case 'client':
      return null;
    case 'buyer':
    case 'seller':
    case 'borrower':
      return null;
    default:
      return 'other';
  }
}

/**
 * Picks one type from all roles a contact held across the rep's orders.
 * Specific classifications beat 'other'; ties break by this precedence so the
 * result is stable regardless of row order.
 */
const TYPE_PRECEDENCE: CrmClientType[] = ['agent', 'lender', 'escrow', 'title', 'other'];

export function deriveClientType(roles: readonly string[]): CrmClientType | null {
  const mapped = new Set<CrmClientType>();
  for (const role of roles) {
    const t = partyRoleToClientType(role);
    if (t) mapped.add(t);
  }
  for (const candidate of TYPE_PRECEDENCE) {
    if (mapped.has(candidate)) return candidate;
  }
  return null;
}
