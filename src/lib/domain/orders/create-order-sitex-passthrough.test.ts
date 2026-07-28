import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  propertyLookupMock,
  softproCreateMock,
  linkSessionMock,
  initiateSearchMock,
  autoTriggerMock,
  getSettingMock,
  insertValuesMock,
  returningMock,
} = vi.hoisted(() => ({
  propertyLookupMock: vi.fn(),
  softproCreateMock: vi.fn(),
  linkSessionMock: vi.fn(),
  initiateSearchMock: vi.fn(),
  autoTriggerMock: vi.fn(),
  getSettingMock: vi.fn(),
  insertValuesMock: vi.fn(),
  returningMock: vi.fn(),
}));

vi.mock('@/lib/integrations/sitex/client', () => ({
  propertyLookup: (...args: unknown[]) => propertyLookupMock(...args),
}));

vi.mock('@/lib/integrations/softpro', () => ({
  createOrder: (...args: unknown[]) => softproCreateMock(...args),
}));

vi.mock('@/lib/domain/titlepoint/pre-initiate', () => ({
  linkSessionToOrder: (...args: unknown[]) => linkSessionMock(...args),
}));

vi.mock('@/lib/domain/titlepoint/service', () => ({
  initiateSearch: (...args: unknown[]) => initiateSearchMock(...args),
}));

vi.mock('@/lib/domain/titlepoint/auto-trigger', () => ({
  autoTriggerTitlePoint: (...args: unknown[]) => autoTriggerMock(...args),
}));

vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('@/lib/integrations/titlepoint/fips', () => ({
  resolveCaliforniaFips: () => '06037',
}));

vi.mock('./softpro-payload', () => ({
  buildSoftProPayload: vi.fn(() => ({})),
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
  companies: { id: 'companies.id', lookupCode: 'companies.lookup_code', isUnderwriter: 'companies.is_underwriter' },
  contacts: { id: 'contacts.id' },
  branches: {},
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
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        insertValuesMock(v);
        return { returning: returningMock };
      },
    })),
  },
}));

import { createAndSendToSoftPro } from './create-order';

const basePayload = {
  orderType: 'Title only' as const,
  isRushOrder: false,
  property: {
    address: '123 Main St',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
    apn: '1234-567-890',
    legalDescription: 'Lot 1',
    county: 'Los Angeles',
  },
  seller: { firstName: 'A', lastName: 'B' },
  buyer: { firstName: 'C', lastName: 'D' },
  transaction: {
    type: 'Purchase' as const,
    product: 'Residential Resale',
    salesAmount: 100000,
    loanAmount: 0,
    coverageAmount: 0,
    branchCode: 'PCT',
  },
};

describe('createAndSendToSoftPro SiteX pass-through + session link', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    softproCreateMock.mockResolvedValue({
      success: true,
      data: { orderNumber: '20012345-OCT' },
    });
    returningMock.mockResolvedValue([{ id: 42 }]);
    linkSessionMock.mockResolvedValue({ linked: 2, finished: 2 });
    initiateSearchMock.mockResolvedValue({ success: true });
    autoTriggerMock.mockResolvedValue({ initiated: 3, failed: 0 });
    getSettingMock.mockResolvedValue('false');
  });

  it('does not call SiteX again when siteXSnapshot is provided', async () => {
    const result = await createAndSendToSoftPro({
      ...basePayload,
      siteXSnapshot: {
        matchCode: 'S',
        apn: '1234-567-890',
        county: 'Los Angeles',
        legalDescription: 'Lot 1',
        fips: '06037',
      },
      titlePointSessionId: 'tp_api_id_123',
    });

    expect(result.success).toBe(true);
    expect(propertyLookupMock).not.toHaveBeenCalled();
    expect(linkSessionMock).toHaveBeenCalledWith('tp_api_id_123', 42, '20012345-OCT');
    expect(initiateSearchMock).toHaveBeenCalledWith(42, 'geo_address', 'system:auto');
    expect(autoTriggerMock).not.toHaveBeenCalled();
  });

  it('falls back to SiteX lookup when no snapshot is provided', async () => {
    propertyLookupMock.mockResolvedValue({
      success: true,
      data: {
        matchCode: 'S',
        apn: '999',
        county: 'Orange',
        legalDescription: 'Lot 9',
        fips: '06059',
        propertyType: null,
        primaryOwner: null,
        secondaryOwner: null,
        fullAddress: null,
        city: null,
        state: null,
        zip: null,
        unitNumber: null,
        beds: null,
        baths: null,
        sqft: null,
        lotSize: null,
        yearBuilt: null,
        assessedValue: null,
        lastSaleDate: null,
        lastSalePrice: null,
      },
    });

    await createAndSendToSoftPro(basePayload);

    expect(propertyLookupMock).toHaveBeenCalledTimes(1);
    expect(autoTriggerMock).toHaveBeenCalled();
    expect(linkSessionMock).not.toHaveBeenCalled();
  });
});
