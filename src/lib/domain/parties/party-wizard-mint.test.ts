import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mint refuses roles that have no form ────────────────────────────────────
//
// A minted URL for buyer_agent / lender_contact opens to a dead end: there is
// no form, and a "new link" fails the same way. The refuse is at mint, before
// insert, so we cannot hand someone a token that can never be completed.

const insertValuesMock = vi.fn();

vi.mock('@/lib/db/schema', () => ({
  contacts: {},
  orderParties: {},
  orderProperties: {},
  orders: {},
  partySubmissions: {},
  partyWizardLinks: { id: 'pwl.id' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  desc: (a: unknown) => a,
  eq: (...a: unknown[]) => a,
  sql: Object.assign((...a: unknown[]) => a, { raw: (s: string) => s }),
}));

vi.mock('drizzle-orm/pg-core', () => ({
  alias: (t: unknown) => t,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        insertValuesMock(v);
        return { returning: async () => [{ id: 1 }] };
      },
    }),
  },
}));

vi.mock('@/lib/integrations/softpro', () => ({ addNotes: vi.fn() }));

import { mintLinkForOrder } from './party-wizard-service';
import type { PartyRole } from './party-wizard-fields';

const SECRET = 'test-party-wizard-secret-value';

const UNSUPPORTED_ROLES: PartyRole[] = [
  'buyer_agent',
  'lender_contact',
  'buyer',
  'seller',
  'lender',
  'escrow_company',
  'borrower',
  'other',
];

describe('mintLinkForOrder refuses roles with no form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PARTY_WIZARD_TOKEN_SECRET = SECRET;
  });

  it.each(UNSUPPORTED_ROLES)('throws for %s before insert', async (role) => {
    await expect(mintLinkForOrder(8123, role, 'test')).rejects.toThrow(
      /Cannot mint a party-wizard link for role/,
    );
    await expect(mintLinkForOrder(8123, role, 'test')).rejects.toThrow(role);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('still mints listing_agent, the only role with a form', async () => {
    const minted = await mintLinkForOrder(8123, 'listing_agent', 'test');
    expect(minted).toEqual(expect.objectContaining({ linkId: 1, url: expect.stringContaining('/party-wizard/') }));
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 8123,
      role: 'listing_agent',
      createdBy: 'test',
    }));
  });
});
