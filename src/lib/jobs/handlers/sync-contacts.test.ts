import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorSuccess } from '../../integrations/types';

const {
  getLookupTableMock,
  getSalesRepsMock,
  updateSets,
  deactivateCalls,
  contactSelectQueue,
  activeRepCount,
} = vi.hoisted(() => ({
  getLookupTableMock: vi.fn(),
  getSalesRepsMock: vi.fn(),
  updateSets: [] as Record<string, unknown>[],
  deactivateCalls: [] as unknown[],
  contactSelectQueue: [] as Array<Array<{ id: number }>>,
  activeRepCount: { value: 0 },
}));

vi.mock('@/lib/db/client', () => {
  const updateSet = vi.fn((vals: Record<string, unknown>) => {
    if (vals.isActive === false) {
      deactivateCalls.push(vals);
    } else {
      updateSets.push(vals);
    }
    return { where: vi.fn(async () => undefined) };
  });

  const select = vi.fn((cols?: Record<string, unknown>) => {
    if (cols && 'count' in cols) {
      return {
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ count: activeRepCount.value }]),
        })),
      };
    }
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => contactSelectQueue.shift() ?? []),
        })),
      })),
    };
  });

  return {
    db: {
      select,
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
      execute: vi.fn(async () => undefined),
    },
  };
});

vi.mock('@/lib/db/schema', () => ({
  companies: {
    id: 'companies.id',
    lookupCode: 'companies.lookup_code',
  },
  contacts: {
    id: 'contacts.id',
    lookupCode: 'contacts.lookup_code',
    flookupCode: 'contacts.flookup_code',
    closerExaminer: 'contacts.closer_examiner',
    softproLookupCode: 'contacts.softpro_lookup_code',
    isSalesRep: 'contacts.is_sales_rep',
    isActive: 'contacts.is_active',
    email: 'contacts.email',
    sourceId: 'contacts.source_id',
  },
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

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  eq: vi.fn((left, right) => ({ type: 'eq', left, right })),
  or: vi.fn((...args: unknown[]) => ({ type: 'or', args })),
  sql: Object.assign(vi.fn((...args: unknown[]) => ({ type: 'sql', args })), {
    raw: vi.fn(),
  }),
}));

import {
  fetchSyncContactRows,
  omitEmptyForUpdate,
  shouldDeactivateExistingSalesReps,
  syncContactRows,
} from './sync-contacts';

describe('omitEmptyForUpdate', () => {
  it('drops null/empty string keys and keeps provided values', () => {
    expect(omitEmptyForUpdate({
      email: 'a@example.com',
      phone: null,
      city: '',
      state: 'CA',
      isActive: true,
    })).toEqual({
      email: 'a@example.com',
      state: 'CA',
      isActive: true,
    });
  });
});

describe('fetchSyncContactRows incremental lookup fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSets.length = 0;
    deactivateCalls.length = 0;
    contactSelectQueue.length = 0;
    activeRepCount.value = 0;
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

describe('syncContactRows preserve-on-empty + sales-rep deactivate guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSets.length = 0;
    deactivateCalls.length = 0;
    contactSelectQueue.length = 0;
    activeRepCount.value = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('preserves existing open-contact fields when SoftPro row is sparse', async () => {
    contactSelectQueue.push([{ id: 10 }]);

    const result = await syncContactRows('Order Contact - Person', [{
      LookupCode: 'OC-1',
      Email: 'keep@example.com',
      FirstName: '',
      LastName: '',
      Phone: '',
      City: '',
      State: '',
    }]);

    expect(result.updated).toBe(1);
    expect(updateSets).toHaveLength(1);
    const set = updateSets[0]!;
    expect(set.email).toBe('keep@example.com');
    expect(set.lookupCode).toBe('OC-1');
    expect(set.isActive).toBe(true);
    expect(set).not.toHaveProperty('firstName');
    expect(set).not.toHaveProperty('lastName');
    expect(set).not.toHaveProperty('phone');
    expect(set).not.toHaveProperty('city');
    expect(set).not.toHaveProperty('state');
  });

  it('does not deactivate sales reps on empty SoftPro response', async () => {
    activeRepCount.value = 12;

    const result = await syncContactRows('Sales Rep', [], {
      deactivateExistingSalesReps: true,
    });

    expect(result.totalFetched).toBe(0);
    expect(deactivateCalls).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      '[sync-contacts] Skipping sales-rep deactivate-all',
      expect.objectContaining({ reason: 'empty SoftPro response' }),
    );
  });

  it('does not deactivate sales reps on a sparse SoftPro response', async () => {
    activeRepCount.value = 20;
    contactSelectQueue.push([{ id: 1 }]);

    const result = await syncContactRows('Sales Rep', [{
      LookUpCode: 'REP-1',
      FullName: '',
      Email: '',
      Phone: '',
    }], { deactivateExistingSalesReps: true });

    expect(result.updated).toBe(1);
    expect(deactivateCalls).toHaveLength(0);
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).not.toHaveProperty('fullName');
    expect(updateSets[0]).not.toHaveProperty('email');
    expect(updateSets[0]?.isActive).toBe(true);
    expect(updateSets[0]?.isSalesRep).toBe(true);
  });

  it('deactivates then updates/activates when SoftPro returns a full roster', async () => {
    activeRepCount.value = 2;
    contactSelectQueue.push([{ id: 1 }], [{ id: 2 }]);

    const result = await syncContactRows('Sales Rep', [
      {
        LookUpCode: 'REP-1',
        FullName: 'One, Ada',
        Email: 'ada@example.com',
        Phone: '555-1111',
      },
      {
        LookUpCode: 'REP-2',
        FullName: 'Two, Bea',
        Email: 'bea@example.com',
        Phone: '555-2222',
      },
    ], { deactivateExistingSalesReps: true });

    expect(result.updated).toBe(2);
    expect(deactivateCalls).toHaveLength(1);
    expect(deactivateCalls[0]).toMatchObject({ isActive: false });
    expect(updateSets).toHaveLength(2);
    expect(updateSets[0]).toMatchObject({
      lookupCode: 'REP-1',
      firstName: 'Ada',
      lastName: 'One',
      email: 'ada@example.com',
      isActive: true,
    });
    expect(updateSets[1]).toMatchObject({
      lookupCode: 'REP-2',
      email: 'bea@example.com',
      isActive: true,
    });
  });

  it('shouldDeactivateExistingSalesReps requires at least half of active roster', async () => {
    activeRepCount.value = 10;
    await expect(shouldDeactivateExistingSalesReps(0)).resolves.toMatchObject({
      deactivate: false,
      reason: 'empty SoftPro response',
    });
    await expect(shouldDeactivateExistingSalesReps(4)).resolves.toMatchObject({
      deactivate: false,
    });
    await expect(shouldDeactivateExistingSalesReps(5)).resolves.toMatchObject({
      deactivate: true,
    });
  });
});
