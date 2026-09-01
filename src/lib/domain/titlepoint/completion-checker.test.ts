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
    emailStatus: 'orders.email_status',
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

describe('getConfirmationReadiness / maybeEnqueueConfirmation (OC-3 legacy gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === 'open_order_confirmation_enabled') return 'true';
      if (key === 'open_order_confirmation_timeout_minutes') return '10';
      return null;
    });
  });

  it('enqueues when Tax+LV are completed — grant deed NOT required', async () => {
    selectLimitMock
      .mockReturnValueOnce(chainSelect([])) // outbox dedup
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'pending' }])) // email_status guard
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'completed', createdAt: new Date() },
        { searchType: 'tax', status: 'completed', createdAt: new Date() },
        // grant_deed still processing — must not block
        { searchType: 'grant_deed', status: 'processing', createdAt: new Date() },
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

  it('enqueues when Tax+LV are terminal even if one failed (no success required)', async () => {
    selectLimitMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'pending' }]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'failed', createdAt: new Date() },
        { searchType: 'tax', status: 'completed', createdAt: new Date() },
      ]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ enqueueReason: 'hard_fail' }),
    }));
  });

  it('does NOT enqueue when LV failed but tax is still in-flight (wait for both)', async () => {
    const recent = new Date();
    selectLimitMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'pending' }]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'failed', createdAt: recent },
        { searchType: 'tax', status: 'processing', createdAt: recent },
      ]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(false);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('enqueues on timeout when searches are still in-flight', async () => {
    const old = new Date(Date.now() - 15 * 60_000);
    selectLimitMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'pending' }]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'processing', createdAt: old },
        { searchType: 'tax', status: 'processing', createdAt: old },
      ]));
    // No orders select: with searches present the anchor is the earliest
    // search createdAt, so the order row is never read.

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
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'pending' }]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'processing', createdAt: recent },
      ]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(false);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  // ─── Order 8136: a day-old order, searches started three seconds ago ──────
  //
  // The live failure this fix exists for. 20021653-GLT was created 1 September
  // with no county, so TitlePoint never ran. A day later the county was filled
  // in and the searches started — and because the timeout was anchored on the
  // ORDER's createdAt, the very first readiness check saw a ~24h-old order
  // against a 10-minute window and returned `timeout` immediately. A
  // confirmation went to the escrow company saying there were no documents.
  // Two minutes later all three completed.
  it('a fresh search on an OLD order is not instantly timed out', async () => {
    const orderCreated = new Date(Date.now() - 24 * 60 * 60_000); // yesterday
    const searchStarted = new Date(Date.now() - 3_000);           // 3s ago

    selectLimitMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'pending' }]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'processing', createdAt: searchStarted },
        { searchType: 'tax', status: 'processing', createdAt: searchStarted },
      ]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(8136);

    expect(enqueued).toBe(false);
    expect(insertValuesMock).not.toHaveBeenCalled();
    // Three selects: outbox, email_status, searches. The ORDER row is never
    // read — reading it is the bug. `orderCreated` exists only to name what the
    // old code would have anchored on.
    expect(selectLimitMock).toHaveBeenCalledTimes(3);
    expect(orderCreated.getTime()).toBeLessThan(searchStarted.getTime());
  });

  it('an old order with NO searches still falls back to the order date', async () => {
    // The genuinely-nothing-started case. Without this an order that will never
    // get TitlePoint would wait for a search that is never coming.
    const orderCreated = new Date(Date.now() - 24 * 60 * 60_000);

    selectLimitMock
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'pending' }]))
      .mockReturnValueOnce(chainSelect([]))
      .mockReturnValueOnce(chainSelect([{ createdAt: orderCreated, openedAt: orderCreated }]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(8136);

    expect(enqueued).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ enqueueReason: 'timeout', noDocuments: true }),
    }));
  });

  it('double-send guard: skips when email_status already sent', async () => {
    selectLimitMock
      .mockReturnValueOnce(chainSelect([])) // no outbox
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'sent' }]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(false);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});
