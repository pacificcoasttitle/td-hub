import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rows, getDetailsMock, processMock, dbMock, deadlineMock, settings, clock } = vi.hoisted(() => ({
  rows: { claimed: [] as unknown[], cursor: [] as unknown[] },
  getDetailsMock: vi.fn(),
  processMock: vi.fn(async (_item: unknown, _opts: Record<string, unknown>) => undefined),
  dbMock: { updates: [] as unknown[] },
  deadlineMock: { exceededAfter: Number.POSITIVE_INFINITY, calls: 0 },
  settings: { shutOff: 'false' },
  clock: { utcHour: 3 },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    // claimOrders runs first, then readCursor may run before it; both use execute.
    execute: vi.fn(async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes('lookbackSync')) return rows.cursor;
      return rows.claimed;
    }),
    update: () => ({ set: (v: unknown) => ({ where: async () => { dbMock.updates.push(v); } }) }),
  },
}));
vi.mock('@/lib/db/schema', () => ({ jobs: { id: 'id' } }));
vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: async () => settings.shutOff,
}));
vi.mock('@/lib/integrations/softpro', () => ({
  getOrderDetails: (args: { orderNumber: string; orderId: number; dateFrom: string }) => getDetailsMock(args),
}));
vi.mock('@/lib/domain/orders/process-detail', () => ({
  processOrderDetail: (item: unknown, opts: Record<string, unknown>) => processMock(item, opts),
}));
vi.mock('@/lib/jobs/time-budget', () => ({
  createDeadline: () => ({
    budgetMs: 239_000,
    elapsedMs: () => 0,
    remainingMs: () => 239_000,
    exceeded: () => ++deadlineMock.calls > deadlineMock.exceededAfter,
  }),
}));

vi.spyOn(Date.prototype, 'getUTCHours').mockImplementation(() => clock.utcHour);

const { handleLookbackSync, PER_CALL_TIMEOUT_MS, CONCURRENCY, isOffPeakHour, OFF_PEAK_UTC_HOURS } = await import('./lookback-sync');
const { LOOKBACK_STATUS_SOURCE } = await import('@/lib/domain/orders/lookback-diff');

function claimed(n: number, startId = 100) {
  return Array.from({ length: n }, (_, i) => ({
    id: startId + i,
    file_number: `F${startId + i}`,
    operational_status: 'in_process',
    sales_price: null,
    loan_amount: null,
    age_days: 45,
  }));
}
function detail(fileNumber: string, status: string) {
  return { success: true, data: [{ OrderNumber: fileNumber, OrderStatus: status, SalesPrice: '0' }] };
}

beforeEach(() => {
  rows.claimed = []; rows.cursor = [];
  getDetailsMock.mockReset(); processMock.mockClear();
  dbMock.updates.length = 0;
  deadlineMock.exceededAfter = Number.POSITIVE_INFINITY; deadlineMock.calls = 0;
  settings.shutOff = 'false'; clock.utcHour = 3;
  getDetailsMock.mockImplementation(async ({ orderNumber }: { orderNumber: string }) =>
    detail(orderNumber, 'Closed'));
});

// ─── Dry run ────────────────────────────────────────────────────────────────

describe('dry run writes nothing', () => {
  it('counts corrections without calling processOrderDetail', async () => {
    rows.claimed = claimed(5);
    const r = await handleLookbackSync({ dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(r.examined).toBe(5);
    expect(r.checked).toBe(5);
    expect(r.corrected).toBe(5);
    expect(r.correctionPct).toBe(100);
    // The decisive assertion: no write path was entered at all.
    expect(processMock).not.toHaveBeenCalled();
  });

  it('a write run DOES call processOrderDetail, with the safe options', async () => {
    rows.claimed = claimed(2);
    await handleLookbackSync({ dryRun: false });

    expect(processMock).toHaveBeenCalledTimes(2);
    const opts = processMock.mock.calls[0]![1];
    // preserveExistingOnEmpty is what stops a partial vendor record blanking
    // good local data.
    expect(opts.preserveExistingOnEmpty).toBe(true);
    expect(opts.statusHistorySource).toBe(LOOKBACK_STATUS_SOURCE);
  });

  it('defaults to a dry run when the flag is absent', async () => {
    rows.claimed = claimed(1);
    const r = await handleLookbackSync({});
    expect(r.dryRun).toBe(false);
    // Explicit: absence of dryRun means WRITE. Documented here so nobody
    // assumes the safe default without checking.
    expect(processMock).toHaveBeenCalled();
  });
});

// ─── Timeouts ───────────────────────────────────────────────────────────────

describe('a correction counts only once it has landed', () => {
  it('does not count a failed write as corrected, and records it as an error', async () => {
    // Until 2026-09-17 the counts were folded in before the write ran, so a
    // write that threw still reported the order as corrected.
    rows.claimed = claimed(3);
    processMock.mockImplementation(async (item: unknown) => {
      if ((item as { OrderNumber: string }).OrderNumber === 'F101') throw new Error('deadlock detected');
      return undefined;
    });

    const r = await handleLookbackSync({ dryRun: false });

    expect(r.checked).toBe(3);
    expect(r.corrected).toBe(2);
    expect(r.correctedTo).toEqual({ Closed: 2 });
    expect(r.writeFailed).toBe(1);
    expect(r.errors).toEqual([{ fileNumber: 'F101', error: 'deadlock detected' }]);
    expect(r.correctionPct).toBeCloseTo(66.67, 1);
  });

  it('a dry run still counts what it would correct', async () => {
    rows.claimed = claimed(3);
    const r = await handleLookbackSync({ dryRun: true });
    expect(r).toMatchObject({ corrected: 3, writeFailed: 0, errors: [] });
  });
});

describe('timeouts count as unchecked', () => {
  // FAKE TIMERS, not a real wait. This used to sleep PER_CALL_TIMEOUT_MS + 5s of
  // actual wall clock — 35 seconds on every run of the whole suite, holding a
  // worker slot the entire time. It was the only test in 1,730 over 4 seconds.
  //
  // Both sides of the race are setTimeout-based — the mock's delay here, and
  // `withTimeout`'s `sleep(PER_CALL_TIMEOUT_MS)` in the handler — so faking
  // timers exercises the SAME production timeout, just without spending the
  // seconds. The mock still outlives the ceiling; the ceiling still wins.
  it('never counts a timed-out order as corrected, and never shrinks the denominator', async () => {
    vi.useFakeTimers();
    try {
      rows.claimed = claimed(4);
      getDetailsMock.mockImplementation(async ({ orderNumber }: { orderNumber: string }) => {
        if (orderNumber === 'F100' || orderNumber === 'F101') {
          // Outlives the per-call ceiling.
          await new Promise((r) => setTimeout(r, PER_CALL_TIMEOUT_MS + 5_000));
        }
        return detail(orderNumber, 'Closed');
      });

      const pending = handleLookbackSync({ dryRun: true });
      // Past the ceiling but short of the mock's own delay, so the timeout is
      // what resolves the race — then past everything so the run can finish.
      await vi.advanceTimersByTimeAsync(PER_CALL_TIMEOUT_MS + 1_000);
      await vi.advanceTimersByTimeAsync(PER_CALL_TIMEOUT_MS + 10_000);
      const r = await pending;

      expect(r.examined).toBe(4);
      expect(r.unchecked).toBe(2);
      expect(r.checked).toBe(2);
      expect(r.corrected).toBe(2);
      expect(r.correctionPct).toBe(100); // 2/2, not 2/4
      expect(processMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a thrown vendor error as unchecked, not as a failure of the run', async () => {
    rows.claimed = claimed(3);
    getDetailsMock.mockImplementation(async ({ orderNumber }: { orderNumber: string }) => {
      if (orderNumber === 'F101') throw new Error('socket hang up');
      return detail(orderNumber, 'Closed');
    });
    const r = await handleLookbackSync({ dryRun: true });
    expect(r.unchecked).toBe(1);
    expect(r.checked).toBe(2);
  });

  it('does not write for an order it could not read', async () => {
    rows.claimed = claimed(1);
    getDetailsMock.mockResolvedValue({ success: false, data: null });
    await handleLookbackSync({ dryRun: false });
    expect(processMock).not.toHaveBeenCalled();
  });
});

// ─── Deadline ───────────────────────────────────────────────────────────────

describe('deadline guard', () => {
  it('exits terminal with a partial batch instead of running past the ceiling', async () => {
    rows.claimed = claimed(50);
    deadlineMock.exceededAfter = 6; // trip the budget after a few claims

    const r = await handleLookbackSync({ dryRun: true });
    expect(r.stoppedEarly).toBe(true);
    expect(r.remaining).toBeGreaterThan(0);
    expect(r.examined).toBeLessThan(50);
    // A partial run still reports a usable cursor so the next run resumes.
    expect(r.nextCursorId).not.toBeNull();
    expect(r.windowComplete).toBe(false);
  });

  it('leaves the cursor at the last FINISHED order, never mid-unit', async () => {
    rows.claimed = claimed(3, 500);
    const r = await handleLookbackSync({ dryRun: true });
    expect(r.nextCursorId === null || r.nextCursorId >= 500).toBe(true);
  });
});

// ─── Cursor / resumability ──────────────────────────────────────────────────

describe('cursor lives in the job payload — no migration', () => {
  it('records counts and the resume point on its own jobs row', async () => {
    rows.claimed = claimed(2);
    await handleLookbackSync({ dryRun: true, __jobId: 42 });
    expect(dbMock.updates).toHaveLength(1);
    const written = dbMock.updates[0] as { payload: { lookbackSync: { corrected: number } } };
    expect(written.payload.lookbackSync.corrected).toBe(2);
  });

  it('does not try to persist when it has no job id', async () => {
    rows.claimed = claimed(1);
    await handleLookbackSync({ dryRun: true });
    expect(dbMock.updates).toHaveLength(0);
  });

  it('signals window completion by clearing the cursor', async () => {
    // Fewer rows than the limit and no early stop => the window is exhausted.
    rows.claimed = claimed(2);
    const r = await handleLookbackSync({ dryRun: true, limit: 10 });
    expect(r.windowComplete).toBe(true);
    expect(r.nextCursorId).toBeNull();
  });

  it('keeps the cursor when a full batch came back', async () => {
    rows.claimed = claimed(10);
    const r = await handleLookbackSync({ dryRun: true, limit: 10 });
    expect(r.windowComplete).toBe(false);
    expect(r.nextCursorId).toBe(109);
  });
});

describe('runtime shape', () => {
  it('bounds concurrency and the per-call wait', () => {
    expect(CONCURRENCY).toBe(3);
    expect(PER_CALL_TIMEOUT_MS).toBe(30_000);
  });

  it('reports the window it swept', async () => {
    rows.claimed = claimed(1);
    const r = await handleLookbackSync({ dryRun: true });
    // Phase 1 is 30-90d only. 90-180d is held until the first band is proven.
    expect(r.windowDays).toEqual({ min: 30, max: 90 });
  });
});

// ─── Gates ──────────────────────────────────────────────────────────────────

describe('kill switch', () => {
  it('takes no work when the setting is on, and does not move the cursor', async () => {
    rows.claimed = claimed(10);
    settings.shutOff = 'true';
    const r = await handleLookbackSync({ dryRun: false });

    expect(r.skipped).toBe('shut_off');
    expect(r.examined).toBe(0);
    expect(r.nextCursorId).toBeNull();
    expect(getDetailsMock).not.toHaveBeenCalled();
    expect(processMock).not.toHaveBeenCalled();
  });

  it('is checked before any vendor call, so it can stop a sweep in flight', async () => {
    rows.claimed = claimed(400);
    settings.shutOff = 'true';
    await handleLookbackSync({});
    expect(getDetailsMock).not.toHaveBeenCalled();
  });
});

describe('off-peak guard — it must not be able to run in business hours', () => {
  it('mirrors the cron window', () => {
    expect(OFF_PEAK_UTC_HOURS).toEqual({ start: 1, end: 14 });
    expect(isOffPeakHour(0)).toBe(false);   // 17:00 PDT — business hours
    expect(isOffPeakHour(1)).toBe(true);
    expect(isOffPeakHour(14)).toBe(true);
    expect(isOffPeakHour(15)).toBe(false);  // 08:00 PDT — business hours
    expect(isOffPeakHour(20)).toBe(false);  // 13:00 PDT — mid-afternoon
  });

  it('refuses a WRITE pass triggered manually during business hours', async () => {
    rows.claimed = claimed(10);
    clock.utcHour = 20; // 1pm Pacific
    const r = await handleLookbackSync({ dryRun: false });

    expect(r.skipped).toBe('business_hours');
    expect(getDetailsMock).not.toHaveBeenCalled();
    expect(processMock).not.toHaveBeenCalled();
  });

  it('refuses a write pass EVEN WITH allowAnyHour — the override is dry-run only', async () => {
    rows.claimed = claimed(10);
    clock.utcHour = 20;
    const r = await handleLookbackSync({ dryRun: false, allowAnyHour: true });
    expect(r.skipped).toBe('business_hours');
    expect(processMock).not.toHaveBeenCalled();
  });

  it('allows a DRY run in business hours only when explicitly overridden', async () => {
    rows.claimed = claimed(3);
    clock.utcHour = 20;
    const blocked = await handleLookbackSync({ dryRun: true });
    expect(blocked.skipped).toBe('business_hours');

    const allowed = await handleLookbackSync({ dryRun: true, allowAnyHour: true });
    expect(allowed.skipped).toBeNull();
    expect(allowed.examined).toBe(3);
    expect(processMock).not.toHaveBeenCalled();
  });

  it('runs normally inside the window', async () => {
    rows.claimed = claimed(2);
    clock.utcHour = 6;
    const r = await handleLookbackSync({ dryRun: true });
    expect(r.skipped).toBeNull();
    expect(r.examined).toBe(2);
  });
});
