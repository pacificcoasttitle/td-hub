import { beforeEach, describe, expect, it, vi } from 'vitest';

// The batch selector and the run record of softpro.enrich_orders.
//
// For two weeks the job reported "completed" every 15 minutes while it read no
// hub-created order at all: such an order is born with a client contact, an
// underwriter and buyer/seller rows, so it matched none of the "missing
// something" arms, and the runner discarded the counts that would have shown it.

const { batchWhere, jobUpdates, runningJobs, candidates, enrichContacts } = vi.hoisted(() => ({
  batchWhere: { value: null as unknown },
  jobUpdates: [] as Array<{ values: Record<string, unknown>; where: unknown }>,
  runningJobs: { rows: [] as Array<{ id: number }> },
  candidates: { rows: [] as Array<Record<string, unknown>> },
  enrichContacts: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: 'and', conditions })),
  or: vi.fn((...conditions: unknown[]) => ({ op: 'or', conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ op: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ op: 'isNull', field })),
  sql: Object.assign(vi.fn(() => ({ op: 'sql' })), { raw: vi.fn(() => ({ op: 'raw' })) }),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    __table: 'orders',
    id: 'orders.id',
    fileNumber: 'orders.file_number',
    orderType: 'orders.order_type',
    source: 'orders.source',
    clientContactId: 'orders.client_contact_id',
    lenderId: 'orders.lender_id',
    listingAgentId: 'orders.listing_agent_id',
    titleCompanyId: 'orders.title_company_id',
    underwriterId: 'orders.underwriter_id',
    lastContactsFetchAt: 'orders.last_contacts_fetch_at',
    contactsReadAt: 'orders.contacts_read_at',
    contactsEmptyConfirmed: 'orders.contacts_empty_confirmed',
  },
  orderParties: { __table: 'order_parties', role: { enumValues: [] } },
  contacts: { __table: 'contacts' },
  companies: { __table: 'companies' },
  vendorApiLogs: { __table: 'vendor_api_logs' },
  jobs: { __table: 'jobs', id: 'jobs.id', status: 'jobs.status', jobType: 'jobs.job_type', startedAt: 'jobs.started_at' },
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getOrderContacts: enrichContacts,
  mapOrderContacts: vi.fn(),
}));
vi.mock('@/lib/domain/orders/client-resolver', () => ({ resolveClientContactId: vi.fn() }));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: { __table?: string }) => ({
        where: vi.fn((condition: unknown) => {
          if (table.__table === 'jobs') return { limit: async () => runningJobs.rows };
          batchWhere.value = condition;
          return { orderBy: () => ({ limit: async () => candidates.rows }) };
        }),
      })),
    })),
    update: vi.fn((table: { __table?: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          if (table.__table === 'jobs') jobUpdates.push({ values, where });
        },
      }),
    })),
    insert: vi.fn(() => ({ values: async () => undefined })),
  },
}));

type Cond = { op?: string; conditions?: Cond[]; field?: unknown };

describe('softpro.enrich_orders batch selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchWhere.value = null;
    jobUpdates.length = 0;
    runningJobs.rows = [];
    candidates.rows = [];
  });

  it('selects orders whose contacts have never been read, as its own arm', async () => {
    const { handleEnrichOrders } = await import('./enrich-orders');

    await handleEnrichOrders({ __jobId: 1 });

    const where = batchWhere.value as Cond;
    expect(where.op).toBe('and');
    const arms = where.conditions![0]!;
    expect(arms.op).toBe('or');
    // Its own arm, not ANDed with the "missing something" conditions: a
    // hub-created order is missing nothing and must still be selected.
    expect(arms.conditions).toContainEqual({ op: 'isNull', field: 'orders.contacts_read_at' });
  });

  it('still gates every arm on the attempt cooldown, so a failing read is not retried every run', async () => {
    const { handleEnrichOrders, contactsFetchDue } = await import('./enrich-orders');

    await handleEnrichOrders({ __jobId: 1 });

    const where = batchWhere.value as Cond;
    expect(where.conditions).toHaveLength(2);
    expect(where.conditions![1]).toEqual(contactsFetchDue());
  });
});

describe('softpro.enrich_orders records what it did', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobUpdates.length = 0;
    runningJobs.rows = [];
    candidates.rows = [];
  });

  it('writes the run counts and errors onto its own job row', async () => {
    candidates.rows = [{ id: 7, fileNumber: '20022227-OCT', orderType: 'Title & Escrow', source: 'manual_entry', clientContactId: 1 }];
    enrichContacts.mockResolvedValue({ success: false, error: { message: 'GetOrderContacts returned no data' } });
    const { handleEnrichOrders } = await import('./enrich-orders');

    const stats = await handleEnrichOrders({ __jobId: 227744 });

    const record = jobUpdates.find((u) => 'payload' in u.values);
    expect(record?.where).toEqual({ op: 'eq', field: 'jobs.id', value: 227744 });
    expect(record?.values).toEqual({ payload: { enrichOrders: stats } });
    expect(stats).toMatchObject({ total: 1, attempted: 1, failed: 1 });
    expect(stats.errors).toEqual([{ fileNumber: '20022227-OCT', error: 'GetOrderContacts returned no data' }]);
  });

  it('records a single-flight skip too, so a skipped run is not a silent one', async () => {
    runningJobs.rows = [{ id: 99 }];
    const { handleEnrichOrders } = await import('./enrich-orders');

    await handleEnrichOrders({ __jobId: 100 });

    expect(jobUpdates).toContainEqual({
      values: { payload: { enrichOrders: expect.objectContaining({ singleFlightSkipped: true, runningJobId: 99 }) } },
      where: { op: 'eq', field: 'jobs.id', value: 100 },
    });
  });

  it('records nothing when run without a job id (a local call)', async () => {
    const { handleEnrichOrders } = await import('./enrich-orders');

    await handleEnrichOrders({});

    expect(jobUpdates.filter((u) => 'payload' in u.values)).toEqual([]);
  });
});
