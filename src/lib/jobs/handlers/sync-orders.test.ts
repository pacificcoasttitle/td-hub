import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SOFTPRO_SEARCH_ROW_CAP } from '@/lib/integrations/softpro/vendor-limits';
import { SYNC_CHUNK_COUNT } from '@/lib/jobs/sync-window';

const {
  getOrdersMock,
  getOrderContactsMock,
  mapSoftProOrderMock,
  mapOrderContactsMock,
  upsertMock,
  getOrderByFileNumberMock,
  propertyLookupMock,
  jobUpdates,
} = vi.hoisted(() => ({
  getOrdersMock: vi.fn(),
  getOrderContactsMock: vi.fn(),
  mapSoftProOrderMock: vi.fn(),
  mapOrderContactsMock: vi.fn(),
  upsertMock: vi.fn(),
  getOrderByFileNumberMock: vi.fn(),
  propertyLookupMock: vi.fn(),
  jobUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
}));

vi.mock('@/lib/db/schema', () => ({
  jobs: { __table: 'jobs', id: 'jobs.id', payload: 'jobs.payload' },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        jobUpdates.push(v);
        return { where: async () => undefined };
      },
    })),
  },
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getOrders: getOrdersMock,
  getOrderContacts: getOrderContactsMock,
  mapSoftProOrder: mapSoftProOrderMock,
  mapOrderContacts: mapOrderContactsMock,
}));

vi.mock('@/lib/domain/orders/service', () => ({
  upsertFromSoftPro: upsertMock,
  getOrderByFileNumber: getOrderByFileNumberMock,
}));

vi.mock('@/lib/domain/orders/apply-sitex-property', () => ({
  applySiteXPropertyFields: vi.fn(async () => ({ applied: false })),
}));

vi.mock('@/lib/integrations/sitex/client', () => ({
  propertyLookup: propertyLookupMock,
}));

const { handleSyncOrders } = await import('./sync-orders');

/** A GetOrders response carrying `count` distinct orders. */
function vendorRows(count: number, prefix = 'A') {
  return {
    success: true,
    data: Array.from({ length: count }, (_, i) => ({
      OrderNumber: `${prefix}${i}`,
      OrderStatus: 'Open',
      LastModifiedOn: '2026-08-27',
      CompletedDate: '',
    })),
  };
}

beforeEach(() => {
  jobUpdates.length = 0;
  getOrdersMock.mockReset();
  getOrderContactsMock.mockReset();
  mapSoftProOrderMock.mockReset();
  mapOrderContactsMock.mockReset();
  upsertMock.mockReset();
  getOrderByFileNumberMock.mockReset();
  propertyLookupMock.mockReset();

  getOrdersMock.mockResolvedValue(vendorRows(0));
  getOrderByFileNumberMock.mockResolvedValue({ id: 1 });
  mapSoftProOrderMock.mockImplementation((item: { OrderNumber: string }) => ({
    fileNumber: item.OrderNumber,
    titleOfficerName: null,
    property: { address: null, city: null, state: null },
  }));
  upsertMock.mockResolvedValue({ created: false, orderId: 1 });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// ─── One call per day, not one call per window ──────────────────────────────
//
// The single wide call is what put the trailing window past SoftPro's silent
// 250-row cap. These pin the shape of the replacement.

describe('the window is requested one day at a time', () => {
  it('makes one narrow call per day instead of a single wide one', async () => {
    const result = await handleSyncOrders();

    expect(getOrdersMock).toHaveBeenCalledTimes(SYNC_CHUNK_COUNT);
    expect(result.vendorListCalls).toBe(SYNC_CHUNK_COUNT);
    for (const [args] of getOrdersMock.mock.calls) {
      expect((args as { dateFrom: string }).dateFrom)
        .toBe((args as { dateTo: string }).dateTo);
    }
  });

  it('still covers the whole window the single call used to cover', async () => {
    const result = await handleSyncOrders();
    const requested = getOrdersMock.mock.calls.map(([a]) => (a as { dateFrom: string }).dateFrom);

    expect(requested[0]).toBe(result.dateFrom);
    expect(requested[requested.length - 1]).toBe(result.dateTo);
    expect(new Set(requested).size).toBe(requested.length);
  });

  it('chunks an explicit backfill range too, so the wide call cannot return by the back door', async () => {
    await handleSyncOrders({ dateFrom: '08-01-2026', dateTo: '08-05-2026' });

    expect(getOrdersMock).toHaveBeenCalledTimes(5);
    expect(getOrdersMock.mock.calls.map(([a]) => a)).toEqual([
      { dateFrom: '08-01-2026', dateTo: '08-01-2026' },
      { dateFrom: '08-02-2026', dateTo: '08-02-2026' },
      { dateFrom: '08-03-2026', dateTo: '08-03-2026' },
      { dateFrom: '08-04-2026', dateTo: '08-04-2026' },
      { dateFrom: '08-05-2026', dateTo: '08-05-2026' },
    ]);
  });

  it('costs vendor calls per DAY, never per order', async () => {
    getOrdersMock.mockResolvedValue(vendorRows(40));
    const result = await handleSyncOrders();

    expect(result.vendorListCalls).toBe(SYNC_CHUNK_COUNT);
    expect(result.totalFetched).toBe(40);
  });
});

describe('de-duplication across days', () => {
  it('processes an order once even when two days both return it', async () => {
    // Adjacent one-day slices do not overlap, but the vendor list is a live
    // query: an order edited between two calls can answer both.
    getOrdersMock.mockResolvedValue(vendorRows(3));

    const result = await handleSyncOrders();

    expect(result.totalFetched).toBe(3);
    expect(upsertMock).toHaveBeenCalledTimes(3);
  });
});

// ─── A failed day is reported, not swallowed, and never aborts the run ──────

describe('one day failing', () => {
  it('retries the day once before giving up on it', async () => {
    getOrdersMock
      .mockResolvedValueOnce({ success: false, data: null, error: { message: 'socket hang up' } })
      .mockResolvedValue(vendorRows(1));

    const result = await handleSyncOrders();

    // 8 days + 1 retry of the first.
    expect(result.vendorListCalls).toBe(SYNC_CHUNK_COUNT + 1);
    expect(result.failedChunks).toBe(0);
  });

  it('records the gap and keeps going when both attempts fail', async () => {
    getOrdersMock
      .mockResolvedValueOnce({ success: false, data: null, error: { message: 'channel faulted' } })
      .mockResolvedValueOnce({ success: false, data: null, error: { message: 'channel faulted' } })
      .mockResolvedValue(vendorRows(1));

    const result = await handleSyncOrders();

    expect(result.failedChunks).toBe(1);
    // The other seven days still ran. Aborting would have thrown them away too.
    expect(result.chunks.filter((c) => c.error === null)).toHaveLength(SYNC_CHUNK_COUNT - 1);
    expect(result.totalFetched).toBe(1);
  });

  it('names the day that was lost, so the gap is auditable rather than a count', async () => {
    getOrdersMock
      .mockResolvedValue(vendorRows(1))
      .mockResolvedValueOnce({ success: false, data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ success: false, data: null, error: { message: 'boom' } });

    const result = await handleSyncOrders();
    const failed = result.chunks.find((c) => c.error !== null);

    expect(failed).toBeDefined();
    expect(failed!.dateFrom).toBe(result.dateFrom);
    expect(failed!.error).toContain('boom');
    expect(failed!.rowCount).toBeNull();
  });

  it('survives getOrders throwing rather than returning a failure', async () => {
    getOrdersMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(vendorRows(1));

    const result = await handleSyncOrders();

    expect(result.failedChunks).toBe(1);
    expect(result.chunks.find((c) => c.error !== null)!.error).toContain('ECONNRESET');
  });

  it('writes the per-day outcome onto its own job row so a gap outlives the function', async () => {
    getOrdersMock
      .mockResolvedValueOnce({ success: false, data: null, error: { message: 'down' } })
      .mockResolvedValueOnce({ success: false, data: null, error: { message: 'down' } })
      .mockResolvedValue(vendorRows(0));

    await handleSyncOrders({ __jobId: 42 });

    expect(jobUpdates).toHaveLength(1);
    const payload = jobUpdates[0]!.payload as { syncOrders: { failedChunks: number } };
    expect(payload.syncOrders.failedChunks).toBe(1);
  });
});

// ─── The truncation alarm ───────────────────────────────────────────────────

describe('a day that comes back exactly at the vendor cap', () => {
  it('is flagged as suspected truncation', async () => {
    getOrdersMock.mockResolvedValue(vendorRows(SOFTPRO_SEARCH_ROW_CAP));

    const result = await handleSyncOrders();

    expect(result.truncationSuspected).toBe(true);
    expect(result.truncationSuspectedChunks).toBe(SYNC_CHUNK_COUNT);
  });

  it('is NOT flagged one row below the cap', async () => {
    getOrdersMock.mockResolvedValue(vendorRows(SOFTPRO_SEARCH_ROW_CAP - 1));

    const result = await handleSyncOrders();

    expect(result.truncationSuspected).toBe(false);
    expect(result.truncationSuspectedChunks).toBe(0);
  });

  it('is NOT flagged one row above the cap', async () => {
    getOrdersMock.mockResolvedValue(vendorRows(SOFTPRO_SEARCH_ROW_CAP + 1));

    const result = await handleSyncOrders();

    expect(result.truncationSuspected).toBe(false);
  });

  it('does not fail the run or stop the remaining days', async () => {
    // The executive has twice rejected backstops that can halt production. This
    // one surfaces and gets out of the way.
    getOrdersMock.mockResolvedValue(vendorRows(SOFTPRO_SEARCH_ROW_CAP));

    const result = await handleSyncOrders();

    expect(result.failedChunks).toBe(0);
    expect(getOrdersMock).toHaveBeenCalledTimes(SYNC_CHUNK_COUNT);
    expect(result.errors).toEqual([]);
    expect(result.totalFetched).toBe(SOFTPRO_SEARCH_ROW_CAP);
  });

  it('carries the suspicion onto the job row, not just into the console', async () => {
    getOrdersMock.mockResolvedValue(vendorRows(SOFTPRO_SEARCH_ROW_CAP));

    await handleSyncOrders({ __jobId: 7 });

    const payload = jobUpdates[0]!.payload as {
      syncOrders: { truncationSuspected: boolean; chunks: Array<{ rowCount: number | null }> };
    };
    expect(payload.syncOrders.truncationSuspected).toBe(true);
    expect(payload.syncOrders.chunks[0]!.rowCount).toBe(SOFTPRO_SEARCH_ROW_CAP);
  });
});
