import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rows each table returns, keyed by the tag on the mocked schema object.
const { rowsFor, inserts, attachMock, autoTriggerMock } = vi.hoisted(() => ({
  rowsFor: {} as Record<string, unknown[]>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  attachMock: vi.fn(),
  autoTriggerMock: vi.fn(),
}));

vi.mock('@/lib/db/schema', () => {
  const t = (tag: string, cols: string[]) => Object.fromEntries([['__tag', tag], ...cols.map((c) => [c, `${tag}.${c}`])]);
  return {
    orders: t('orders', ['id', 'fileNumber', 'operationalStatus']),
    orderProperties: t('order_properties', ['id', 'orderId']),
    orderStatusHistory: t('order_status_history', ['id', 'orderId']),
    titlePointData: t('title_point_data', ['id', 'orderId']),
    adminActivityLogs: t('admin_activity_logs', ['action', 'entityId', 'createdAt', 'meta']),
    vendorApiLogs: t('vendor_api_logs', ['vendor', 'operation', 'requestMeta', 'responseMeta', 'startedAt']),
  };
});

vi.mock('drizzle-orm', () => {
  const sql = Object.assign((..._a: unknown[]) => ({}), { raw: () => ({}) });
  return { and: vi.fn(), desc: vi.fn(), eq: vi.fn(), sql };
});

vi.mock('@/lib/db/client', () => {
  const chain = (rows: unknown[]) => {
    const self: Record<string, unknown> = {};
    self.where = () => self;
    self.orderBy = () => self;
    self.limit = async () => rows;
    return self;
  };
  return {
    db: {
      select: () => ({ from: (table: { __tag: string }) => chain(rowsFor[table.__tag] ?? []) }),
      insert: (table: { __tag: string }) => ({
        values: async (values: Record<string, unknown>) => { inserts.push({ table: table.__tag, values }); },
      }),
    },
  };
});

vi.mock('./create-order', () => ({
  attachMissingOrderProperty: (...a: unknown[]) => attachMock(...a),
  propertyFromSoftProCreatePayload: (pd: { Address1: string; City: string; State: string; Zip: string; Country: string; APNNumberParcelID: string }) => ({
    property: { address: pd.Address1, city: pd.City, state: pd.State, zip: pd.Zip },
    enriched: { apn: pd.APNNumberParcelID, legal: '', county: pd.Country, fips: '06073' },
  }),
}));
vi.mock('@/lib/domain/titlepoint/auto-trigger', () => ({
  autoTriggerTitlePoint: (...a: unknown[]) => autoTriggerMock(...a),
}));

import { getReconcileState, reconcileFailedCreate } from './reconcile-create';

const ORDER = { id: 8687, fileNumber: '20022166-GLT', operationalStatus: 'open' };
const FAILURE = {
  createdAt: new Date('2026-09-15T00:04:19Z'),
  meta: { code: '22001', message: 'value too long for type character varying(50)', failedStatement: 'insert into order_properties' },
};
const PAYLOAD = {
  propertyDetails: {
    Address1: '1222 N Coast Highway 101', City: 'Encinitas', State: 'CA', Zip: '92024',
    Country: 'SAN DIEGO', APNNumberParcelID: '254-230-18-01',
  },
};

describe('reconcile a half-created order', () => {
  beforeEach(() => {
    for (const k of Object.keys(rowsFor)) delete rowsFor[k];
    inserts.length = 0;
    attachMock.mockReset().mockResolvedValue('inserted');
    autoTriggerMock.mockReset().mockResolvedValue({ initiated: 3, skipped: false });
    rowsFor.orders = [ORDER];
  });

  it('is not offered for an order with no recorded failed create', async () => {
    // The gate that keeps this from being a "write a property row" button for
    // any order an operator happens to be looking at.
    expect(await getReconcileState(8687)).toEqual({ needed: false, reason: 'no_failure_recorded' });
    const result = await reconcileFailedCreate(8687, 'user-1');
    expect(result).toMatchObject({ ok: false, code: 'NOT_NEEDED' });
    expect(attachMock).not.toHaveBeenCalled();
  });

  it('is not offered when the property is already there (the sync race, cause B)', async () => {
    rowsFor.admin_activity_logs = [FAILURE];
    rowsFor.order_properties = [{ id: 1 }];
    expect(await getReconcileState(8687)).toEqual({ needed: false, reason: 'property_present' });
  });

  it('is not offered for a canceled order', async () => {
    rowsFor.orders = [{ ...ORDER, operationalStatus: 'canceled' }];
    rowsFor.admin_activity_logs = [FAILURE];
    expect(await getReconcileState(8687)).toEqual({ needed: false, reason: 'canceled' });
  });

  it('refuses rather than guess when no SoftPro payload is logged', async () => {
    rowsFor.admin_activity_logs = [FAILURE];
    const result = await reconcileFailedCreate(8687, 'user-1');
    expect(result).toMatchObject({ ok: false, code: 'MISSING_PAYLOAD' });
    expect(attachMock).not.toHaveBeenCalled();
    expect(autoTriggerMock).not.toHaveBeenCalled();
  });

  it('offers it with the recorded reason in words', async () => {
    rowsFor.admin_activity_logs = [FAILURE];
    rowsFor.vendor_api_logs = [PAYLOAD];
    expect(await getReconcileState(8687)).toEqual({
      needed: true,
      fileNumber: '20022166-GLT',
      failedAt: '2026-09-15T00:04:19.000Z',
      reason: 'A value was longer than its column allows (value too long for type character varying(50)) during insert into order_properties.',
      payloadAvailable: true,
    });
  });

  it('finishes it: property from the logged payload, status history, TitlePoint, and who pressed it', async () => {
    rowsFor.admin_activity_logs = [FAILURE];
    rowsFor.vendor_api_logs = [PAYLOAD];

    const result = await reconcileFailedCreate(8687, 'user-1');

    expect(result).toEqual({
      ok: true, fileNumber: '20022166-GLT', property: 'inserted', statusHistory: 'inserted', titlePoint: 'started',
    });
    expect(attachMock).toHaveBeenCalledWith(
      8687,
      { property: { address: '1222 N Coast Highway 101', city: 'Encinitas', state: 'CA', zip: '92024' } },
      null,
      { apn: '254-230-18-01', legal: '', county: 'SAN DIEGO', fips: '06073' },
    );
    expect(autoTriggerMock).toHaveBeenCalledWith(8687, expect.objectContaining({ county: 'SAN DIEGO', apn: '254-230-18-01' }));
    expect(inserts.map((i) => i.table)).toEqual(['order_status_history', 'admin_activity_logs']);
    expect(inserts[1]!.values).toMatchObject({ userId: 'user-1', action: 'order_create_reconciled', entityId: '20022166-GLT' });
  });

  it('does not start a second title search, or a second status row', async () => {
    rowsFor.admin_activity_logs = [FAILURE];
    rowsFor.vendor_api_logs = [PAYLOAD];
    rowsFor.order_status_history = [{ id: 5 }];
    rowsFor.title_point_data = [{ id: 9 }];

    const result = await reconcileFailedCreate(8687, 'user-1');

    expect(result).toMatchObject({ ok: true, statusHistory: 'already_present', titlePoint: 'already_started' });
    expect(autoTriggerMock).not.toHaveBeenCalled();
    expect(inserts.map((i) => i.table)).toEqual(['admin_activity_logs']);
  });
});
