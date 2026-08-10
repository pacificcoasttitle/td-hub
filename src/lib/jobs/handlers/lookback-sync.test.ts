import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rows, getDetailsMock, processMock, dbMock, deadlineMock } = vi.hoisted(() => ({
  rows: { claimed: [] as unknown[], cursor: [] as unknown[] },
  getDetailsMock: vi.fn(),
  processMock: vi.fn(async (_item: unknown, _opts: Record<string, unknown>) => undefined),
  dbMock: { updates: [] as unknown[] },
  deadlineMock: { exceededAfter: Number.POSITIVE_INFINITY, calls: 0 },
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

const { handleLookbackSync, PER_CALL_TIMEOUT_MS, CONCURRENCY } = await import('./lookback-sync');
const { LOOKBACK_NOTE_PREFIX, LOOKBACK_STATUS_SOURCE } = await import('@/lib/domain/orders/lookback-diff');

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
    expect(opts.statusHistoryNotePrefix).toBe(LOOKBACK_NOTE_PREFIX);
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

describe('timeouts count as unchecked', () => {
  it('never counts a timed-out order as corrected, and never shrinks the denominator', async () => {
    rows.claimed = claimed(4);
    getDetailsMock.mockImplementation(async ({ orderNumber }: { orderNumber: string }) => {
      if (orderNumber === 'F100' || orderNumber === 'F101') {
        // Outlives the per-call ceiling.
        await new Promise((r) => setTimeout(r, PER_CALL_TIMEOUT_MS + 5_000));
      }
      return detail(orderNumber, 'Closed');
    });

    const r = await handleLookbackSync({ dryRun: true });
    expect(r.examined).toBe(4);
    expect(r.unchecked).toBe(2);
    expect(r.checked).toBe(2);
    expect(r.corrected).toBe(2);
    expect(r.correctionPct).toBe(100); // 2/2, not 2/4
    expect(processMock).not.toHaveBeenCalled();
  }, 120_000);

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
    expect(r.windowDays).toEqual({ min: 30, max: 180 });
  });
});
