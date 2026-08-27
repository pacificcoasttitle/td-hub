import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executed,
  getOrderDetailsMock,
  getOrderContactsMock,
  mapOrderContactsMock,
  sampleRows,
  jobUpdates,
  partyTable,
  partyWrites,
  orderRows,
} = vi.hoisted(() => ({
  executed: [] as Array<{ strings: readonly string[]; values: unknown[] }>,
  getOrderDetailsMock: vi.fn(),
  getOrderContactsMock: vi.fn(),
  mapOrderContactsMock: vi.fn(),
  sampleRows: { rows: [] as Array<{ id: number; file_number: string; band: string }> },
  jobUpdates: [] as Array<Record<string, unknown>>,
  /** Stand-in for the order_parties rows the order already has. */
  partyTable: { rows: [] as Array<Record<string, unknown>> },
  partyWrites: {
    inserts: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ id: unknown; values: Record<string, unknown> }>,
  },
  orderRows: { rows: [] as Array<Record<string, unknown>> },
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
  orders: { __table: 'orders', id: 'orders.id' },
  orderParties: { __table: 'order_parties', id: 'order_parties.id', orderId: 'order_parties.order_id' },
  contacts: { __table: 'contacts', softproLookupCode: 'contacts.lookup', fullName: 'contacts.full_name' },
}));

vi.mock('@/lib/db/client', () => {
  // The handler awaits some selects directly and others through .limit(1).
  const rowsFor = (table: { __table?: string } | undefined) => {
    if (table?.__table === 'order_parties') return partyTable.rows;
    if (table?.__table === 'orders') return orderRows.rows;
    return [];
  };
  const thenable = (rows: unknown[]) => {
    const self: Record<string, unknown> = {};
    self.limit = async () => rows;
    self.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, err);
    return self;
  };

  return {
    db: {
      execute: vi.fn(async () => sampleRows.rows),
      update: vi.fn((table: { __table?: string }) => ({
        set: (v: Record<string, unknown>) => {
          if (table?.__table === 'order_parties') {
            return {
              where: async (cond: { value?: unknown }) => {
                partyWrites.updates.push({ id: cond?.value, values: v });
              },
            };
          }
          if (table?.__table === 'jobs') jobUpdates.push(v);
          return { where: async () => undefined };
        },
      })),
      select: vi.fn(() => ({
        from: (table: { __table?: string }) => ({ where: () => thenable(rowsFor(table)) }),
      })),
      insert: vi.fn((table: { __table?: string }) => ({
        values: async (v: Record<string, unknown>) => {
          if (table?.__table === 'order_parties') partyWrites.inserts.push(v);
        },
      })),
    },
  };
});

vi.mock('@/lib/integrations/softpro', () => ({
  getOrderDetails: getOrderDetailsMock,
  getOrderContacts: getOrderContactsMock,
  mapOrderContacts: mapOrderContactsMock,
}));

const { handleVerifyOrderSync, verifySingleOrder, DRIFT_SAMPLE_SIZE } = await import('./verify-order-sync');

function ok(orderNumber: string, status: string) {
  return { success: true, data: [{ OrderNumber: orderNumber, OrderStatus: status }] };
}

beforeEach(() => {
  executed.length = 0;
  jobUpdates.length = 0;
  partyWrites.inserts.length = 0;
  partyWrites.updates.length = 0;
  partyTable.rows = [];
  orderRows.rows = [];
  getOrderDetailsMock.mockReset();
  getOrderContactsMock.mockReset();
  mapOrderContactsMock.mockReset();
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

// ─── reconcileParties matches on (role, is_primary) ─────────────────────────
//
// reconcileParties looks the local row up with
//   existing.find((p) => p.role === u.role && p.isPrimary === u.isPrimary)
// and INSERTS when that misses. It never deletes, so a miss does not replace the
// operator's row — it strands it. Two rows for one party, and the one carrying
// the operator's contact_id is the one that strict is_primary readers skip.
//
// The open-order form used to write its contact parties on the column default of
// false, so every one of those lookups missed. These tests pin both halves: the
// mechanism (a non-primary row is NOT matched) and the outcome now that
// create-order writes true.
//
// Already seen in production from a different writer pair: orders 11, 27 and 42
// each hold a lender_contact row from 11 March with a raw lookup code at
// is_primary = false plus a second from 13 June with the resolved name at
// is_primary = true.

const ORDER_ID = 7308;
const OPERATOR_LENDER_CONTACT_ID = 7101;

/** What SoftPro reports back for the same order. */
function vendorContacts(overrides: Record<string, unknown> = {}) {
  return {
    primaryBuyer: 'C D',
    secondaryBuyer: null,
    primarySeller: 'A B',
    secondarySeller: null,
    lenderCompanyCode: null,
    escrowCompanyCode: null,
    escrowPersonCode: null,
    titleOfficerName: null,
    parties: {
      buyer: null,
      secondaryBuyer: null,
      seller: null,
      secondarySeller: null,
      // The vendor's canonical spelling of the company the operator typed.
      lender: { name: 'Lender Person', companyName: 'Barrett Financial Group, Inc.' },
      secondaryLender: null,
      listingAgent: null,
      escrowCompany: null,
      mortgageBroker: null,
      titleCompany: null,
      underwriter: null,
    },
    ...overrides,
  };
}

/** The lender party row the operator entered through the hub form. */
function operatorLenderRow(isPrimary: boolean) {
  return {
    id: 33,
    orderId: ORDER_ID,
    role: 'lender',
    isPrimary,
    contactId: OPERATOR_LENDER_CONTACT_ID,
    externalName: 'Lender Person',
    externalCompany: 'Barrett Financial Group',
    externalEmail: 'lender@example.com',
    externalPhone: '555-0101',
    source: null,
  };
}

function seedOrder(lenderIsPrimary: boolean) {
  partyTable.rows = [
    { id: 31, orderId: ORDER_ID, role: 'seller', isPrimary: true, contactId: null, externalName: 'A B', externalCompany: null, externalEmail: null, externalPhone: null },
    { id: 32, orderId: ORDER_ID, role: 'buyer', isPrimary: true, contactId: null, externalName: 'C D', externalCompany: null, externalEmail: null, externalPhone: null },
    operatorLenderRow(lenderIsPrimary),
  ];
  // Both officers already assigned, so reconcileOfficers is a no-op here.
  orderRows.rows = [{ titleOfficerId: 91, escrowOfficerId: 92, salesRepId: 93 }];
  getOrderContactsMock.mockResolvedValue({ success: true, data: {} });
  mapOrderContactsMock.mockReturnValue(vendorContacts());
}

describe('reconcileParties over an operator-entered party', () => {
  // The bug, characterised. Left in deliberately: it is the reason create-order
  // must write true, and it must keep failing this way if anyone is tempted to
  // "fix" the duplicate by loosening the reconciler's match instead.
  it('does NOT match a non-primary row, and inserts a second one beside it', async () => {
    seedOrder(false);

    await verifySingleOrder(ORDER_ID, '20021376-OCT');

    expect(partyWrites.inserts).toHaveLength(1);
    expect(partyWrites.inserts[0]).toMatchObject({
      role: 'lender',
      isPrimary: true,
      externalCompany: 'Barrett Financial Group, Inc.',
    });
    // The operator's row was neither updated nor removed — just orphaned, with
    // the contact_id on it.
    expect(partyWrites.updates).toHaveLength(0);
    expect(partyWrites.inserts[0]!.contactId).toBeUndefined();
  });

  it('matches the primary row and updates it, leaving one lender row', async () => {
    seedOrder(true);

    await verifySingleOrder(ORDER_ID, '20021376-OCT');

    expect(partyWrites.inserts).toHaveLength(0);
    expect(partyWrites.updates).toHaveLength(1);
    expect(partyWrites.updates[0]!.id).toBe(33);
  });

  // The merge rule both SoftPro writers use is per-field and non-empty-only. The
  // vendor's company name wins because it is populated, but everything the
  // vendor did not send — above all the contact_id the typeahead resolved — is
  // left alone. That FK is the whole point of the sibling persistence change.
  it('keeps the operator contact link and contact details the vendor did not send', async () => {
    seedOrder(true);

    await verifySingleOrder(ORDER_ID, '20021376-OCT');

    const written = partyWrites.updates[0]!.values;
    expect(written).toEqual({ externalCompany: 'Barrett Financial Group, Inc.' });
    expect(written).not.toHaveProperty('contactId');
    expect(written).not.toHaveProperty('externalEmail');
    expect(written).not.toHaveProperty('externalPhone');
  });

  // A party the vendor has nothing for must not be touched at all — reconcile
  // skips entries with neither a name nor a company, so a hub-only party
  // survives a read-back untouched.
  it('leaves the operator row alone when the vendor reports no lender', async () => {
    seedOrder(true);
    mapOrderContactsMock.mockReturnValue(vendorContacts({
      parties: { ...vendorContacts().parties, lender: null },
    }));

    await verifySingleOrder(ORDER_ID, '20021376-OCT');

    expect(partyWrites.inserts).toHaveLength(0);
    expect(partyWrites.updates).toHaveLength(0);
  });
});
