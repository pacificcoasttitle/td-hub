import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vendorSuccess, vendorError } from '../../integrations/types';

const {
  getLookupTableMock,
  getSalesRepsMock,
  updateSets,
  updateWheres,
  deactivateCalls,
  contactSelectQueue,
  contactSelectWheres,
  orderByCalls,
  updateFailures,
  activeRepCount,
} = vi.hoisted(() => ({
  getLookupTableMock: vi.fn(),
  getSalesRepsMock: vi.fn(),
  updateSets: [] as Record<string, unknown>[],
  updateWheres: [] as unknown[],
  deactivateCalls: [] as unknown[],
  contactSelectQueue: [] as Array<Array<{ id: number; lookupCode?: string }>>,
  contactSelectWheres: [] as unknown[],
  orderByCalls: [] as unknown[][],
  updateFailures: [] as unknown[],
  activeRepCount: { value: 0 },
}));

vi.mock('@/lib/db/client', () => {
  const updateSet = vi.fn((vals: Record<string, unknown>) => {
    if (vals.isActive === false) {
      deactivateCalls.push(vals);
    } else {
      updateSets.push(vals);
    }
    return {
      where: vi.fn(async (w: unknown) => {
        updateWheres.push(w);
        const failure = updateFailures.shift();
        if (failure) throw failure;
        return undefined;
      }),
    };
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
        where: vi.fn((w: unknown) => {
          contactSelectWheres.push(w);
          const limit = vi.fn(async () => contactSelectQueue.shift() ?? []);
          // Drizzle's builder is thenable: awaiting .where() runs the query.
          // The mock has to be too, or a caller that reads a whole page in one
          // go — rather than .limit(1) per row — gets the builder object back
          // and fails on something unrelated to what it was testing.
          return {
            limit,
            orderBy: vi.fn((...args: unknown[]) => {
              orderByCalls.push(args);
              return { limit };
            }),
            then: (
              resolve: (rows: Array<{ id: number; lookupCode?: string }>) => unknown,
              reject?: (e: unknown) => unknown,
            ) => Promise.resolve(contactSelectQueue.shift() ?? []).then(resolve, reject),
          };
        }),
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
  asc: vi.fn((col) => ({ type: 'asc', col })),
  eq: vi.fn((left, right) => ({ type: 'eq', left, right })),
  // syncOpenContacts reads the whole page in one query now, not one per row.
  inArray: vi.fn((col, values) => ({ type: 'inArray', col, values })),
  or: vi.fn((...args: unknown[]) => ({ type: 'or', args })),
  sql: Object.assign(vi.fn((...args: unknown[]) => ({ type: 'sql', args })), {
    raw: vi.fn(),
  }),
}));

import {
  describeSyncError,
  fetchSyncContactRows,
  omitEmptyForUpdate,
  shouldDeactivateExistingSalesReps,
  syncContactRows,
} from './sync-contacts';

/**
 * One SoftPro "Escrow Officer" feed row, in the shape the vendor sends.
 *
 * `Row State` is part of that shape — every well-formed row on the live feed
 * carries it, and the shape guard treats its absence as the signature of a
 * column shift. It was missing from this fixture, which made the fixture
 * itself malformed by the vendor's own convention.
 */
function officerRow(overrides: Record<string, string> = {}) {
  return {
    'Escrow officer/Closer': 'PCT\\aballesteros',
    'Office LookupCode': 'PRV',
    'Officer Name': 'Anna Ballesteros',
    Email: 'aballesteros@pct.com',
    'Row State': 'Unchanged',
    ...overrides,
  };
}

/**
 * The real `PCT\jgomez` row from the production feed, 27 Aug 2026: shifted one
 * column left, so `Officer Name` is empty, `Email` holds the `Row State` value
 * "Unchanged", and `Row State` itself is gone.
 */
function shiftedGomezRow() {
  return {
    'Escrow officer/Closer': 'PCT\\jgomez',
    'Office LookupCode': 'GLT',
    'Officer Name': '',
    Email: 'Unchanged',
    LastModifiedAt: '2026-05-12T20:30:24Z',
  };
}

function resetAll(): void {
  vi.clearAllMocks();
  updateSets.length = 0;
  updateWheres.length = 0;
  deactivateCalls.length = 0;
  contactSelectQueue.length = 0;
  contactSelectWheres.length = 0;
  orderByCalls.length = 0;
  updateFailures.length = 0;
  activeRepCount.value = 0;
}

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

// ── The deterministic officer match ─────────────────────────────────────────
//
// Four officers exist twice under one `PCT\user` code: the feed row carries
// closer_examiner AND softpro_lookup_code, the address-book twin carries only
// softpro_lookup_code. The old predicate was an OR over both columns with
// limit 1 and no ORDER BY, so which row came back was the query plan's choice.
describe('officer match is deterministic', () => {
  beforeEach(resetAll);

  it('picks the closer_examiner row when BOTH rows satisfy the old predicate', async () => {
    // Queue: dedupe guard finds no canonical row, then the closer_examiner
    // lookup finds contact 12 — the office-bearing feed row.
    contactSelectQueue.push([], [{ id: 12 }]);

    const result = await syncContactRows('Escrow Officer', [officerRow()]);

    expect(result.updated).toBe(1);
    expect(result.errors).toEqual([]);

    // The match ran as an equality on closer_examiner, not an OR across two
    // columns. Two selects total: the guard, then the match. The
    // softpro_lookup_code fallback was never reached, so the twin could not win.
    expect(contactSelectWheres).toHaveLength(2);
    expect(contactSelectWheres[1]).toEqual({
      type: 'eq',
      left: 'contacts.closer_examiner',
      right: 'PCT\\aballesteros',
    });
    expect(orderByCalls).toHaveLength(0);

    // And the write landed on 12, the row that holds the office code.
    expect(updateWheres[0]).toEqual({ type: 'eq', left: 'contacts.id', right: 12 });
    expect(updateSets[0]).toMatchObject({
      closerExaminer: 'PCT\\aballesteros',
      officeLookupCode: 'PRV',
      isEscrowOfficer: true,
    });
  });

  it('is stable across runs — the same row every time, not the plan of the day', async () => {
    const chosen: unknown[] = [];
    for (let run = 0; run < 3; run++) {
      resetAll();
      contactSelectQueue.push([], [{ id: 12 }]);
      await syncContactRows('Escrow Officer', [officerRow()]);
      chosen.push(updateWheres[0]);
    }
    expect(chosen).toEqual([
      { type: 'eq', left: 'contacts.id', right: 12 },
      { type: 'eq', left: 'contacts.id', right: 12 },
      { type: 'eq', left: 'contacts.id', right: 12 },
    ]);
  });

  it('falls back to softpro_lookup_code only when no feed row exists, and orders it', async () => {
    // Guard clear, closer_examiner miss, then the address-book row.
    contactSelectQueue.push([], [], [{ id: 17165 }]);

    const result = await syncContactRows('Escrow Officer', [officerRow()]);

    expect(result.updated).toBe(1);
    expect(contactSelectWheres).toHaveLength(3);
    expect(contactSelectWheres[2]).toEqual({
      type: 'eq',
      left: 'contacts.softpro_lookup_code',
      right: 'PCT\\aballesteros',
    });
    // The fallback is ordered, so even it cannot be a coin flip.
    expect(orderByCalls).toHaveLength(1);
    expect(orderByCalls[0]).toHaveLength(2);
    expect(orderByCalls[0]![1]).toEqual({ type: 'asc', col: 'contacts.id' });
    expect(updateWheres[0]).toEqual({ type: 'eq', left: 'contacts.id', right: 17165 });
  });

  it('applies the same match to title officers', async () => {
    contactSelectQueue.push([{ id: 5 }]);

    const result = await syncContactRows('Title Officer', [{
      'Title officer/Examiner': 'PCT\\cvirata',
      'Office LookupCode': 'OCT',
      'Officer Name': 'Clive Virata',
      Email: 'unit66@pct.com',
    }]);

    expect(result.updated).toBe(1);
    expect(contactSelectWheres[0]).toEqual({
      type: 'eq',
      left: 'contacts.closer_examiner',
      right: 'PCT\\cvirata',
    });
  });
});

// ── The swallowed error becomes visible ─────────────────────────────────────
describe('a unique violation is named, not buried', () => {
  beforeEach(resetAll);

  /** How Drizzle surfaces a driver failure: the query as message, pg on cause. */
  function drizzleUniqueViolation() {
    return Object.assign(
      new Error('Failed query: update "contacts" set "closer_examiner" = $1 ...\nparams: PCT\\aballesteros'),
      { cause: { code: '23505', constraint_name: 'contacts_closer_examiner_uniq' } },
    );
  }

  it('reports the constraint instead of the statement, and keeps going', async () => {
    // Two officers. The first update collides; the second must still land.
    updateFailures.push(drizzleUniqueViolation());
    contactSelectQueue.push(
      [], [{ id: 17165 }],   // officer 1: guard clear, matched
      [], [{ id: 13 }],      // officer 2: guard clear, matched
    );

    const result = await syncContactRows('Escrow Officer', [
      officerRow(),
      officerRow({
        'Escrow officer/Closer': 'PCT\\cquintanar',
        'Office LookupCode': 'OCT',
        'Officer Name': 'Christine Quintanar',
        Email: 'cquintanar@pct.com',
      }),
    ]);

    expect(result.errors).toHaveLength(1);
    const message = result.errors[0]!.error;
    expect(result.errors[0]!.lookupCode).toBe('PCT\\aballesteros');
    expect(message).toContain('unique violation on contacts_closer_examiner_uniq');
    expect(message).toContain('already belongs to a different contacts row');
    expect(message).not.toContain('Failed query');

    // One officer's failure did not end the run.
    expect(result.updated).toBe(1);
    expect(updateWheres[1]).toEqual({ type: 'eq', left: 'contacts.id', right: 13 });
  });

  it('describeSyncError names the constraint whether pg is on cause or on the error', () => {
    expect(describeSyncError(drizzleUniqueViolation()))
      .toContain('unique violation on contacts_closer_examiner_uniq');
    expect(describeSyncError({ code: '23505', constraint_name: 'contacts_pkey' }))
      .toContain('unique violation on contacts_pkey');
    expect(describeSyncError(new Error('plain failure'))).toBe('plain failure');
  });
});

// ── The shape guard ─────────────────────────────────────────────────────────
//
// The officer match was fixed in PR #55, which unblocked a write that lands bad
// data: `PCT\jgomez`'s feed row is column-shifted, so the first successful sync
// after that fix would have written `email = 'Unchanged'` onto his contact.
describe('a column-shifted officer row is rejected, not imported', () => {
  beforeEach(() => {
    resetAll();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('writes nothing at all for the shifted row', async () => {
    const result = await syncContactRows('Escrow Officer', [shiftedGomezRow()]);

    // No match query, no update, no insert — the row is declined before any of
    // that. Partially importing it, or shifting the values back, would be a
    // guess about which column moved.
    expect(contactSelectWheres).toHaveLength(0);
    expect(updateSets).toHaveLength(0);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
  });

  it('names the officer and says the row was rejected for shape', async () => {
    const result = await syncContactRows('Escrow Officer', [shiftedGomezRow()]);

    // Recorded as an error, not a silent `skipped++`, so it reaches jobs.error
    // and contact_sync_state.last_error.
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.lookupCode).toBe('PCT\\jgomez');
    expect(result.errors[0]!.error).toContain('REJECTED for shape');
    expect(result.errors[0]!.error).toContain('SoftPro');
    expect(result.rejected).toEqual([
      { lookupCode: 'PCT\\jgomez', reasons: expect.any(Array) },
    ]);
  });

  it('still imports a well-formed row', async () => {
    contactSelectQueue.push([], [{ id: 12 }]);

    const result = await syncContactRows('Escrow Officer', [officerRow()]);

    expect(result.updated).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(updateSets[0]).toMatchObject({
      officeLookupCode: 'PRV',
      email: 'aballesteros@pct.com',
      isEscrowOfficer: true,
    });
  });

  it('one malformed row does not prevent the others syncing', async () => {
    // Gomez sits in the middle. The two well-formed officers either side of him
    // must both land — a malformed vendor row must not halt the feed.
    contactSelectQueue.push(
      [], [{ id: 12 }],   // Ballesteros: guard clear, matched
      [], [{ id: 16 }],   // Vidaca: guard clear, matched
    );

    const result = await syncContactRows('Escrow Officer', [
      officerRow(),
      shiftedGomezRow(),
      officerRow({
        'Escrow officer/Closer': 'PCT\\lvidaca',
        'Office LookupCode': 'GLT',
        'Officer Name': 'Lupe Vidaca',
        Email: 'lvidaca@pct.com',
      }),
    ]);

    expect(result.updated).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(updateWheres).toEqual([
      { type: 'eq', left: 'contacts.id', right: 12 },
      { type: 'eq', left: 'contacts.id', right: 16 },
    ]);
    // And the officer whose branch code was stale gets the vendor's value.
    expect(updateSets[1]).toMatchObject({ officeLookupCode: 'GLT', lookupCode: 'GLT' });
  });

  it('rejects a shifted row even when the displaced value looks like a real email', async () => {
    // The case a narrow `Email === 'Unchanged'` test would wave through.
    const result = await syncContactRows('Escrow Officer', [{
      'Escrow officer/Closer': 'PCT\\someone',
      'Office LookupCode': 'GLT',
      'Officer Name': 'someone@pct.com',
      Email: 'GLT',
      'Row State': 'Unchanged',
    }]);

    expect(result.updated).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(updateSets).toHaveLength(0);
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

  it('paginates until a page comes back empty, ignoring hasMore entirely', async () => {
    // This test used to be called "paginates until HasMore is false" and it
    // passed for over a year while the sync read 1,000 rows and stopped: the
    // mock set hasMore itself, so it tested the loop against a flag the real
    // parser never populated. hasMore is deliberately WRONG on both pages here
    // — false on the page that has more, true on the last — so the only way to
    // pass is to page until the vendor returns nothing.
    getLookupTableMock
      .mockResolvedValueOnce(vendorSuccess({
        items: [{ LookupCode: 'A' }],
        hasMore: false,
        page: 1, pageSize: 1, modifiedSince: '2026-07-13T18:00:00.000Z',
        totalRows: 2, totalPages: 2,
      }))
      .mockResolvedValueOnce(vendorSuccess({
        items: [{ LookupCode: 'B' }],
        hasMore: true,
        page: 2, pageSize: 1, modifiedSince: '2026-07-13T18:00:00.000Z',
        totalRows: 2, totalPages: 2,
      }))
      .mockResolvedValue(vendorSuccess({
        items: [],
        hasMore: true,
        page: 3, pageSize: 1, modifiedSince: '2026-07-13T18:00:00.000Z',
        totalRows: 2, totalPages: 2,
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
      userType: 'Lender', Page: 1, pageSize: 1, modifiedSince: '2026-07-13T18:00:00.000Z',
    });
    expect(getLookupTableMock).toHaveBeenNthCalledWith(2, {
      userType: 'Lender', Page: 2, pageSize: 1, modifiedSince: '2026-07-13T18:00:00.000Z',
    });
  });

  it('retries an empty page once before treating it as the end', async () => {
    // Page 1 returned zero rows once during the investigation and 1,000 rows
    // on the next call. One empty response is not proof the data ran out.
    getLookupTableMock
      .mockResolvedValueOnce(vendorSuccess({
        items: [], hasMore: false, page: 1, pageSize: 1, modifiedSince: null,
        totalRows: null, totalPages: null,
      }))
      .mockResolvedValueOnce(vendorSuccess({
        items: [{ LookupCode: 'LATE' }], hasMore: false, page: 1, pageSize: 1,
        modifiedSince: null, totalRows: null, totalPages: null,
      }))
      .mockResolvedValue(vendorSuccess({
        items: [], hasMore: false, page: 2, pageSize: 1, modifiedSince: null,
        totalRows: null, totalPages: null,
      }));

    const result = await fetchSyncContactRows('Lender', { modifiedSince: null, pageSize: 1 });
    expect(result).toEqual({ items: [{ LookupCode: 'LATE' }], error: null });
  });

  it('a hard failure mid-pagination is an error, never a short success', async () => {
    // Returning what was collected so far is indistinguishable from a complete
    // sync, which is the exact shape of the bug this file now guards.
    getLookupTableMock
      .mockResolvedValueOnce(vendorSuccess({
        items: [{ LookupCode: 'A' }], hasMore: false, page: 1, pageSize: 1,
        modifiedSince: null, totalRows: null, totalPages: null,
      }))
      .mockResolvedValue(vendorError('softpro', 'TIMEOUT', 'gateway timeout', { retryable: true }));

    const result = await fetchSyncContactRows('Lender', { modifiedSince: null, pageSize: 1 });
    expect(result.items).toEqual([]);
    expect(result.error).toBe('gateway timeout');
  });

  it('legacy: modifiedSince is still passed through on the first call', async () => {
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
      }))
      // The loop now ends on an empty page, so every test must supply one.
      .mockResolvedValue(vendorSuccess({
        items: [], hasMore: false, page: 3, pageSize: 1,
        modifiedSince: '2026-07-13T18:00:00.000Z', totalRows: 2, totalPages: 2,
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
    getLookupTableMock
      .mockResolvedValueOnce(vendorSuccess({
        items: [{ LookupCode: 'FULL' }],
        hasMore: false,
        page: 1,
        pageSize: 1000,
        modifiedSince: null,
        totalRows: 1,
        totalPages: 1,
      }))
      .mockResolvedValue(vendorSuccess({
        items: [], hasMore: false, page: 2, pageSize: 1000, modifiedSince: null,
        totalRows: 1, totalPages: 1,
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
    // syncOpenContacts reads the page in one query and keys the result by
    // lookup code, so the row it finds has to carry one.
    contactSelectQueue.push([{ id: 10, lookupCode: 'OC-1' }]);

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
