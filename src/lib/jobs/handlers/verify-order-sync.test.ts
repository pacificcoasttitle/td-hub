import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executed, getOrderDetailsMock, sampleRows, jobUpdates } = vi.hoisted(() => ({
  executed: [] as Array<{ strings: readonly string[]; values: unknown[] }>,
  getOrderDetailsMock: vi.fn(),
  sampleRows: { rows: [] as Array<{ id: number; file_number: string; band: string }> },
  jobUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    executed.push({ strings: [...strings], values });
    return { op: 'sql', strings: [...strings], values };
  },
}));

vi.mock('@/lib/db/schema', () => ({
  jobs: { __table: 'jobs', id: 'jobs.id', payload: 'jobs.payload' },
  orders: { __table: 'orders' },
  orderParties: { __table: 'order_parties' },
  contacts: { __table: 'contacts' },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    execute: vi.fn(async () => sampleRows.rows),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        jobUpdates.push(v);
        return { where: async () => undefined };
      },
    })),
    select: vi.fn(() => ({ from: () => ({ where: async () => [] }) })),
    insert: vi.fn(() => ({ values: async () => undefined })),
  },
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getOrderDetails: getOrderDetailsMock,
  getOrderContacts: vi.fn(),
  mapOrderContacts: vi.fn(),
}));

const { handleVerifyOrderSync, DRIFT_SAMPLE_SIZE } = await import('./verify-order-sync');

function ok(orderNumber: string, status: string) {
  return { success: true, data: [{ OrderNumber: orderNumber, OrderStatus: status }] };
}

beforeEach(() => {
  executed.length = 0;
  jobUpdates.length = 0;
  getOrderDetailsMock.mockReset();
  sampleRows.rows = [];
});

describe('the sampled population — this is the bug that made it a no-op', () => {
  it("samples in_process orders, NOT status='open'", async () => {
    sampleRows.rows = [];
    await handleVerifyOrderSync({});

    const query = executed.map((e) => e.strings.join('?')).join('\n');
    expect(query).toContain("operational_status = 'in_process'");
    // The original filter examined 2 of 6,612 rows and reported success.
    expect(query).not.toContain("operational_status = 'open'");
  });

  it('bounds the sample so the run fits the function ceiling', async () => {
    sampleRows.rows = [];
    await handleVerifyOrderSync({});
    const limitValues = executed.flatMap((e) => e.values);
    expect(limitValues).toContain(DRIFT_SAMPLE_SIZE);
    expect(DRIFT_SAMPLE_SIZE).toBeGreaterThanOrEqual(20);
    expect(DRIFT_SAMPLE_SIZE).toBeLessThanOrEqual(60);
  });
});

describe('drift counting', () => {
  it('counts terminal SoftPro statuses as drift and in-process as clean', async () => {
    sampleRows.rows = [
      { id: 1, file_number: 'A', band: '30-90d' },
      { id: 2, file_number: 'B', band: '30-90d' },
      { id: 3, file_number: 'C', band: '<30d' },
      { id: 4, file_number: 'D', band: '<30d' },
    ];
    getOrderDetailsMock
      .mockResolvedValueOnce(ok('A', 'Closed'))
      .mockResolvedValueOnce(ok('B', 'Completed'))
      .mockResolvedValueOnce(ok('C', 'InProcess'))
      .mockResolvedValueOnce(ok('D', 'Canceled'));

    const r = await handleVerifyOrderSync({});
    expect(r.checked).toBe(4);
    expect(r.drifted).toBe(3);
    expect(r.driftPct).toBe(75);
    expect(r.driftedTo).toEqual({ Closed: 1, Completed: 1, Canceled: 1 });
  });

  it('records a per-band breakdown without letting it weight the headline', async () => {
    sampleRows.rows = [
      { id: 1, file_number: 'A', band: '30-90d' },
      { id: 2, file_number: 'B', band: '>180d' },
    ];
    getOrderDetailsMock
      .mockResolvedValueOnce(ok('A', 'Closed'))
      .mockResolvedValueOnce(ok('B', 'InProcess'));

    const r = await handleVerifyOrderSync({});
    expect(r.byBand).toEqual({
      '30-90d': { checked: 1, drifted: 1 },
      '>180d': { checked: 1, drifted: 0 },
    });
    // Headline is the plain rate over all checked, not an average of bands.
    expect(r.driftPct).toBe(50);
  });
});

describe('failures never shrink the denominator', () => {
  it('counts a failed call as unchecked, not as clean', async () => {
    sampleRows.rows = [
      { id: 1, file_number: 'A', band: '<30d' },
      { id: 2, file_number: 'B', band: '<30d' },
    ];
    getOrderDetailsMock
      .mockResolvedValueOnce(ok('A', 'Closed'))
      .mockResolvedValueOnce({ success: false, data: null });

    const r = await handleVerifyOrderSync({});
    expect(r.checked).toBe(1);
    expect(r.unchecked).toBe(1);
    // 1 of 1 checked drifted. Had the failure counted as clean it would read 50%.
    expect(r.driftPct).toBe(100);
  });

  it('counts a thrown call as unchecked and keeps going', async () => {
    sampleRows.rows = [
      { id: 1, file_number: 'A', band: '<30d' },
      { id: 2, file_number: 'B', band: '<30d' },
    ];
    getOrderDetailsMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(ok('B', 'InProcess'));

    const r = await handleVerifyOrderSync({});
    expect(r.unchecked).toBe(1);
    expect(r.checked).toBe(1);
    expect(r.drifted).toBe(0);
  });

  it('an unknown SoftPro status is unchecked, never guessed', async () => {
    sampleRows.rows = [{ id: 1, file_number: 'A', band: '<30d' }];
    getOrderDetailsMock.mockResolvedValueOnce(ok('A', 'Some New Status'));

    const r = await handleVerifyOrderSync({});
    expect(r.unchecked).toBe(1);
    expect(r.checked).toBe(0);
    expect(r.driftPct).toBeNull();
  });

  it('a run where everything fails reports null drift, not 0%', async () => {
    sampleRows.rows = [
      { id: 1, file_number: 'A', band: '<30d' },
      { id: 2, file_number: 'B', band: '<30d' },
    ];
    getOrderDetailsMock.mockResolvedValue({ success: false, data: null });

    const r = await handleVerifyOrderSync({});
    expect(r.checked).toBe(0);
    expect(r.driftPct).toBeNull();
    expect(r.unchecked).toBe(2);
  });
});

describe('it is a detector, not a fixer', () => {
  it('writes no order status and reconciles nothing', async () => {
    sampleRows.rows = [{ id: 1, file_number: 'A', band: '<30d' }];
    getOrderDetailsMock.mockResolvedValueOnce(ok('A', 'Closed'));

    await handleVerifyOrderSync({ __jobId: 99 });

    // The only write is the job recording its own counts.
    expect(jobUpdates).toHaveLength(1);
    expect(jobUpdates[0]).toHaveProperty('payload');
    const payload = jobUpdates[0]!.payload as Record<string, unknown>;
    expect(payload).toHaveProperty('statusDrift');
    expect(payload).not.toHaveProperty('operationalStatus');
  });

  it('does not attempt to record counts when it has no job id', async () => {
    sampleRows.rows = [{ id: 1, file_number: 'A', band: '<30d' }];
    getOrderDetailsMock.mockResolvedValueOnce(ok('A', 'Closed'));

    const r = await handleVerifyOrderSync({});
    expect(jobUpdates).toHaveLength(0);
    expect(r.drifted).toBe(1);
  });
});
