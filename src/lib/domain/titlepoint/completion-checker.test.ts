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
      ]))
      .mockReturnValueOnce(chainSelect([{ createdAt: recent, openedAt: recent }]));

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
      .mockReturnValueOnce(chainSelect([{ emailStatus: 'pending' }]))
      .mockReturnValueOnce(chainSelect([
        { searchType: 'legal_vesting', status: 'processing', createdAt: recent },
      ]))
      .mockReturnValueOnce(chainSelect([{ createdAt: recent, openedAt: recent }]));

    const { maybeEnqueueConfirmation } = await import('./completion-checker');
    const enqueued = await maybeEnqueueConfirmation(50);

    expect(enqueued).toBe(false);
    expect(insertValuesMock).not.toHaveBeenCalled();
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
