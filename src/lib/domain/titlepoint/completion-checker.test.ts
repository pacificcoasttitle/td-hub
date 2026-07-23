import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSettingMock = vi.fn();
const selectLimitMock = vi.fn();
const insertValuesMock = vi.fn();

vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn() }),
}));

vi.mock('@/lib/db/schema', () => ({
  titlePointData: {
    orderId: 'tp.order_id',
    searchType: 'tp.search_type',
    status: 'tp.status',
    createdAt: 'tp.created_at',
  },
  eventOutbox: {
    id: 'eo.id',
    orderId: 'eo.order_id',
    eventType: 'eo.event_type',
  },
  orders: {
    id: 'orders.id',
    createdAt: 'orders.created_at',
    openedAt: 'orders.opened_at',
  },
}));

/** Supports both `.where().limit()` and `await .where()` (no limit). */
function chainSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({
    limit,
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  }));
  const from = vi.fn(() => ({ where }));
  return { from, where, limit };
}

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => selectLimitMock()),
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        insertValuesMock(...args);
        return Promise.resolve();
      },
    })),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

describe('getConfirmationReadiness / maybeEnqueueConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === 'open_order_confirmation_enabled') return 'true';
      if (key === 'open_order_confirmation_timeout_minutes') return '10';
      return null;
    });
  });

  it('enqueues when all three searches are completed', async () => {
    selectLimitMock
      .mockReturnValueOnce(chainSelect([])) // hasConfirmationBeenSent
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'completed', createdAt: new Date() },
        { searchType: 'tax', status: 'completed', createdAt: new Date() },
        { searchType: 'grant_deed', status: 'completed', createdAt: new Date() },
      ]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'order.confirmation',
      orderId: 50,
      payload: expect.objectContaining({ enqueueReason: 'complete', noDocuments: false }),
    }));
  });

  it('enqueues on hard-fail without waiting forever', async () => {
    selectLimitMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'failed', createdAt: new Date() },
        { searchType: 'tax', status: 'pending', createdAt: new Date() },
      ]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        enqueueReason: 'hard_fail',
        missingSearches: expect.arrayContaining(['legal_vesting', 'tax', 'grant_deed']),
      }),
    }));
  });

  it('enqueues on timeout when searches are still in-flight', async () => {
    const old = new Date(Date.now() - 15 * 60_000);
    selectLimitMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'processing', createdAt: old },
        { searchType: 'tax', status: 'processing', createdAt: old },
      ]))
      .mockReturnValueOnce(chainSelect([{ createdAt: old, openedAt: old }]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ enqueueReason: 'timeout' }),
    }));
  });

  it('does not enqueue when incomplete and still within timeout', async () => {
    const recent = new Date();
    selectLimitMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'processing', createdAt: recent },
      ]))
      .mockReturnValueOnce(chainSelect([{ createdAt: recent, openedAt: recent }]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(false);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});
