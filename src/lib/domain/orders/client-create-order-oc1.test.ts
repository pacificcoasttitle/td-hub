import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAndSendMock = vi.hoisted(() => vi.fn());

vi.mock('./create-order', () => ({
  createAndSendToSoftPro: (...args: unknown[]) => createAndSendMock(...args),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  },
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: { id: 'contacts.id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => a),
}));

import { clientCreateOrder } from './client-create-order';

describe('clientCreateOrder OC-1 pass-through', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createAndSendMock.mockResolvedValue({ success: true, orderId: 7, fileNumber: '20011111-OCT' });
  });

  it('passes titlePointSessionId + siteXSnapshot into createAndSendToSoftPro', async () => {
    await clientCreateOrder(
      {
        clientDetails: { clientType: 'escrow_company' },
        property: {
          street: '123 Main',
          city: 'Glendale',
          state: 'CA',
          zip: '91203',
          apn: '1-2-3',
          county: 'Los Angeles',
          legalDescription: 'Lot 1',
        },
        seller: { primary: { firstName: 'A', lastName: 'B' }, hasSecondary: false, isOrg: false },
        transaction: {
          transactionType: 'Purchase',
          productType: 'Residential Resale',
          orderType: 'title_only',
          primaryBorrower: { firstName: 'C', lastName: 'D' },
          hasSecondaryBorrower: false,
          borrowerIsOrg: false,
        },
        parties: { showAgents: false, showLender: false, showEscrow: false },
        titlePointSessionId: 'tp_api_id_client',
        siteXSnapshot: {
          matchCode: 'S',
          apn: '1-2-3',
          county: 'Los Angeles',
          legalDescription: 'Lot 1',
        },
      },
      { id: 'user-1', email: 'c@example.com', contactId: null } as never,
    );

    expect(createAndSendMock).toHaveBeenCalledTimes(1);
    const payload = createAndSendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.titlePointSessionId).toBe('tp_api_id_client');
    expect(payload.siteXSnapshot).toEqual({
      matchCode: 'S',
      apn: '1-2-3',
      county: 'Los Angeles',
      legalDescription: 'Lot 1',
    });
    expect((payload.property as { address: string }).address).toBe('123 Main');
  });
});
