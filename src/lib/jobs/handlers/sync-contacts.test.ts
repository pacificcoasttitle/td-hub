import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorSuccess } from '../../integrations/types';
import { fetchSyncContactRows } from './sync-contacts';

const { getLookupTableMock, getSalesRepsMock } = vi.hoisted(() => ({
  getLookupTableMock: vi.fn(),
  getSalesRepsMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {},
}));

vi.mock('@/lib/db/schema', () => ({
  companies: {},
  contacts: {},
}));

vi.mock('@/lib/domain/contacts/company-constants', () => ({
  COMPANY_TYPE_MAP: {
    real_estate_company: 'Selling Agent/Broker',
    title_company: 'Title Company',
  },
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getLookupTable: getLookupTableMock,
  getSalesReps: getSalesRepsMock,
}));

describe('fetchSyncContactRows incremental lookup fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes modifiedSince and paginates until HasMore is false', async () => {
    getLookupTableMock
      .mockResolvedValueOnce(vendorSuccess({
        items: [{ LookupCode: 'A' }],
        hasMore: true,
        page: 1,
        pageSize: 1,
        modifiedSince: '2026-07-13T18:00:00.000Z',
      }))
      .mockResolvedValueOnce(vendorSuccess({
        items: [{ LookupCode: 'B' }],
        hasMore: false,
        page: 2,
        pageSize: 1,
        modifiedSince: '2026-07-13T18:00:00.000Z',
      }));

    const result = await fetchSyncContactRows('Lender', {
      modifiedSince: '2026-07-13T18:00:00.000Z',
      pageSize: 1,
    });

    expect(result).toEqual({
      items: [{ LookupCode: 'A' }, { LookupCode: 'B' }],
      error: null,
    });
    expect(getLookupTableMock).toHaveBeenNthCalledWith(1, {
      userType: 'Lender',
      Page: 1,
      pageSize: 1,
      modifiedSince: '2026-07-13T18:00:00.000Z',
    });
    expect(getLookupTableMock).toHaveBeenNthCalledWith(2, {
      userType: 'Lender',
      Page: 2,
      pageSize: 1,
      modifiedSince: '2026-07-13T18:00:00.000Z',
    });
  });

  it('omits modifiedSince for first-run full resync fallback', async () => {
    getLookupTableMock.mockResolvedValueOnce(vendorSuccess({
      items: [{ LookupCode: 'FULL' }],
      hasMore: false,
      page: 1,
      pageSize: 1000,
      modifiedSince: null,
    }));

    const result = await fetchSyncContactRows('Lender', { modifiedSince: null });

    expect(result).toEqual({ items: [{ LookupCode: 'FULL' }], error: null });
    expect(getLookupTableMock).toHaveBeenCalledWith({
      userType: 'Lender',
      Page: 1,
      pageSize: 1000,
    });
  });
});
