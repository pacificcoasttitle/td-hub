import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A refusal is only useful if the operator sees it. buildSoftProPayload and the
 * pre-send check throw, and the create route's catch-all turns any thrown error
 * into a generic "Order creation failed" 500 — so createAndSendToSoftPro has to
 * convert SoftProPayloadError into a returned message, and must not call SoftPro.
 */

const {
  propertyLookupMock,
  softproCreateMock,
  autoTriggerMock,
  getSettingMock,
  buildPayloadMock,
  assertTitleOfficeMock,
  FakePayloadError,
} = vi.hoisted(() => ({
  propertyLookupMock: vi.fn(),
  softproCreateMock: vi.fn(),
  autoTriggerMock: vi.fn(),
  getSettingMock: vi.fn(),
  buildPayloadMock: vi.fn(),
  assertTitleOfficeMock: vi.fn(),
  FakePayloadError: class FakePayloadError extends Error {},
}));

vi.mock('@/lib/integrations/sitex/client', () => ({
  propertyLookup: (...args: unknown[]) => propertyLookupMock(...args),
}));
vi.mock('@/lib/integrations/softpro', () => ({
  createOrder: (...args: unknown[]) => softproCreateMock(...args),
}));
vi.mock('@/lib/domain/titlepoint/pre-initiate', () => ({ linkSessionToOrder: vi.fn() }));
vi.mock('@/lib/domain/titlepoint/service', () => ({ initiateSearch: vi.fn() }));
vi.mock('@/lib/domain/titlepoint/auto-trigger', () => ({
  autoTriggerTitlePoint: (...args: unknown[]) => autoTriggerMock(...args),
}));
vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));
vi.mock('@/lib/integrations/titlepoint/fips', () => ({ resolveCaliforniaFips: () => '06037' }));

vi.mock('./softpro-payload', () => ({
  buildSoftProPayload: (...args: unknown[]) => buildPayloadMock(...args),
  assertKnownTitleOffice: (...args: unknown[]) => assertTitleOfficeMock(...args),
  SoftProPayloadError: FakePayloadError,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => a),
  and: vi.fn((...a: unknown[]) => a),
  inArray: vi.fn((...a: unknown[]) => a),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: { id: 'orders.id' },
  orderProperties: {},
  orderParties: {},
  orderStatusHistory: {},
  eventOutbox: {},
  companies: { id: 'companies.id', lookupCode: 'c.lookup_code', isUnderwriter: 'c.is_underwriter' },
  contacts: { id: 'contacts.id', isTitleOfficer: 'c.is_title_officer', officeLookupCode: 'c.office_lookup_code' },
  branches: {},
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
        limit: vi.fn(async () => []),
      })),
    })),
    insert: vi.fn(() => ({ values: () => ({ returning: vi.fn(async () => [{ id: 1 }]) }) })),
  },
}));

import { createAndSendToSoftPro } from './create-order';

const input = {
  orderType: 'Title & Escrow' as const,
  isRushOrder: false,
  property: {
    address: '1234 W Walnut Ave', city: 'Visalia', state: 'CA', zip: '93277',
    apn: '094-190-011', legalDescription: 'Lot 7', county: 'Tulare',
  },
  seller: { firstName: 'A', lastName: 'B' },
  buyer: { firstName: 'C', lastName: 'D' },
  transaction: {
    type: 'Purchase', product: 'Residential Resale',
    salesAmount: 100000, loanAmount: 0, coverageAmount: 0,
  },
};

describe('createAndSendToSoftPro title-office refusals', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    propertyLookupMock.mockResolvedValue({ success: false });
    getSettingMock.mockResolvedValue('false');
    autoTriggerMock.mockResolvedValue({ initiated: 0, failed: 0 });
    buildPayloadMock.mockReturnValue({ transactionDetails: {} });
  });

  it('returns the builder refusal to the caller instead of throwing', async () => {
    buildPayloadMock.mockImplementation(() => {
      throw new FakePayloadError('Title officer Rachel Barcena has no office code');
    });

    const result = await createAndSendToSoftPro(input);

    expect(result).toEqual({
      success: false,
      error: 'Title officer Rachel Barcena has no office code',
    });
    expect(softproCreateMock).not.toHaveBeenCalled();
  });

  it('returns the pre-send refusal and never reaches SoftPro', async () => {
    assertTitleOfficeMock.mockImplementation(() => {
      throw new FakePayloadError('Not sending this order: "PRV" is not a title office.');
    });

    const result = await createAndSendToSoftPro(input);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not sending this order: "PRV" is not a title office.');
    expect(softproCreateMock).not.toHaveBeenCalled();
  });

  it('checks the office against the known set before sending, not after', async () => {
    softproCreateMock.mockResolvedValue({ success: true, data: { orderNumber: '20012345-OCT' } });
    const callOrder: string[] = [];
    assertTitleOfficeMock.mockImplementation(() => { callOrder.push('assert'); });
    softproCreateMock.mockImplementation(async () => {
      callOrder.push('send');
      return { success: true, data: { orderNumber: '20012345-OCT' } };
    });

    await createAndSendToSoftPro(input);

    expect(callOrder).toEqual(['assert', 'send']);
  });

  it('lets unrelated failures keep failing loudly rather than swallowing them', async () => {
    buildPayloadMock.mockImplementation(() => { throw new TypeError('boom'); });
    await expect(createAndSendToSoftPro(input)).rejects.toThrow('boom');
  });
});
