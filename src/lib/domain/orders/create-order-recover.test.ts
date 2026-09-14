import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import {
  ORDER_NOT_CREATED_SAFE_TO_RETRY,
  softProCreatedDoNotReenter,
} from './recover-created-file';

const {
  propertyLookupMock,
  softproCreateMock,
  getOrderDetailsMock,
  autoTriggerMock,
  getSettingMock,
  insertValuesMock,
  returningMock,
  ordersRows,
} = vi.hoisted(() => ({
  // What a SELECT on orders returns. Empty for the create's own lookups; a
  // test sets it when the failure happens, as the orders row then exists.
  ordersRows: { value: [] as unknown[] },
  propertyLookupMock: vi.fn(),
  softproCreateMock: vi.fn(),
  getOrderDetailsMock: vi.fn(),
  autoTriggerMock: vi.fn(),
  getSettingMock: vi.fn(),
  insertValuesMock: vi.fn(),
  returningMock: vi.fn(),
}));

vi.mock('@/lib/integrations/sitex/client', () => ({
  propertyLookup: (...args: unknown[]) => propertyLookupMock(...args),
}));
vi.mock('@/lib/integrations/softpro', () => ({
  createOrder: (...args: unknown[]) => softproCreateMock(...args),
  getOrderDetails: (...args: unknown[]) => getOrderDetailsMock(...args),
}));
vi.mock('@/lib/domain/titlepoint/pre-initiate', () => ({ linkSessionToOrder: vi.fn() }));
vi.mock('@/lib/domain/titlepoint/service', () => ({ initiateSearch: vi.fn() }));
vi.mock('@/lib/domain/titlepoint/auto-trigger', () => ({
  autoTriggerTitlePoint: (...args: unknown[]) => autoTriggerMock(...args),
}));
vi.mock('@/lib/domain/settings/service', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));
vi.mock('@/lib/integrations/titlepoint/fips', () => ({ resolveCaliforniaFips: () => '06037' }));
vi.mock('./softpro-payload', () => ({
  buildSoftProPayload: vi.fn(() => ({})),
  assertKnownTitleOffice: vi.fn(),
  SoftProPayloadError: class extends Error {},
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a: unknown[]) => a),
  and: vi.fn((...a: unknown[]) => a),
  inArray: vi.fn((...a: unknown[]) => a),
}));
vi.mock('@/lib/db/schema', () => ({
  orders: { id: 'orders.id', fileNumber: 'orders.file_number' },
  orderProperties: {},
  orderParties: {},
  orderStatusHistory: {},
  eventOutbox: {},
  companies: { id: 'companies.id', lookupCode: 'c.lookup_code', isUnderwriter: 'c.is_underwriter' },
  contacts: { id: 'contacts.id', isTitleOfficer: 'c.is_title_officer', officeLookupCode: 'c.office_lookup_code' },
  branches: {},
  orderDeliverableEmails: {},
  adminActivityLogs: { name: 'admin_activity_logs' },
  profiles: { id: 'profiles.id', email: 'profiles.email' },
}));

vi.mock('@/lib/db/client', () => {
  const query = (rows: unknown[]) => {
    const self: Record<string, unknown> = {};
    self.where = () => self;
    self.limit = async () => rows;
    self.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, err);
    return self;
  };
  return {
    db: {
      select: vi.fn(() => ({
        from: (table: { fileNumber?: string } | undefined) =>
          query(table?.fileNumber === 'orders.file_number' ? ordersRows.value : []),
      })),
      insert: vi.fn(() => ({
        values: (...args: unknown[]) => {
          insertValuesMock(...args);
          return { returning: returningMock };
        },
      })),
    },
  };
});

import { createAndSendToSoftPro } from './create-order';

const input = {
  orderType: 'Title only' as const,
  isRushOrder: false,
  property: {
    address: '15181 Jackson St', city: 'Midway City', state: 'CA', zip: '92655',
  },
  seller: { firstName: 'A', lastName: 'B' },
  buyer: { firstName: 'C', lastName: 'D' },
  transaction: {
    type: 'Purchase', product: 'Residential Resale',
    salesAmount: 0, loanAmount: 0, coverageAmount: 0,
  },
};

describe('create recover — timeout and post-200 share one treatment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    ordersRows.value = [];
    propertyLookupMock.mockResolvedValue({ success: false });
    getSettingMock.mockResolvedValue('false');
    autoTriggerMock.mockResolvedValue({ skipped: true });
    returningMock.mockResolvedValue([{ id: 42 }]);
    getOrderDetailsMock.mockResolvedValue({ success: true, data: [] });
  });

  it('timeout + Found + persist attaches the hub row and does not create again', async () => {
    softproCreateMock.mockResolvedValue({
      success: false,
      error: { code: 'TIMEOUT', message: 'The operation was aborted due to timeout' },
    });
    getOrderDetailsMock.mockResolvedValue({
      success: true,
      data: [{
        OrderNumber: '20021683-OCT',
        Address: '15181 Jackson St',
        City: 'Midway City',
        ReceivedDate: '2026-09-01T01:43:37',
      }],
    });

    const result = await createAndSendToSoftPro(input, 'manual_entry');

    expect(softproCreateMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.fileNumber).toBe('20021683-OCT');
    expect(result.orderId).toBe(42);
    expect(result.createdInSoftPro).toBe(true);
    expect(result.submitLocked).toBe(true);
  });

  it('timeout + Found + persist fail returns Gerard\'s copy and locks submit', async () => {
    softproCreateMock.mockResolvedValue({
      success: false,
      error: { code: 'TIMEOUT', message: 'The operation was aborted due to timeout' },
    });
    getOrderDetailsMock.mockResolvedValue({
      success: true,
      data: [{
        OrderNumber: '20021683-OCT',
        Address: '15181 Jackson St',
        City: 'Midway City',
        ReceivedDate: '2026-09-01T01:43:37',
      }],
    });
    returningMock.mockRejectedValue(new Error('value too long for type character varying(50)'));

    const result = await createAndSendToSoftPro(input, 'manual_entry');

    expect(softproCreateMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: false,
      fileNumber: '20021683-OCT',
      createdInSoftPro: true,
      submitLocked: true,
      error: softProCreatedDoNotReenter('20021683-OCT'),
    });
  });

  it('timeout + Not found is safe to try again and does not lock', async () => {
    softproCreateMock.mockResolvedValue({
      success: false,
      error: { code: 'TIMEOUT', message: 'The operation was aborted due to timeout' },
    });
    getOrderDetailsMock.mockResolvedValue({ success: true, data: [] });

    const result = await createAndSendToSoftPro(input, 'manual_entry');

    expect(result).toEqual({
      success: false,
      error: ORDER_NOT_CREATED_SAFE_TO_RETRY,
      submitLocked: false,
    });
    expect(result.error).not.toMatch(/abort/i);
  });

  it('SoftPro 200 then hub insert fail uses the same Found copy — no second create', async () => {
    softproCreateMock.mockResolvedValue({ success: true, data: { orderNumber: '20021683-OCT' } });
    returningMock.mockRejectedValue(new Error('value too long for type character varying(50)'));

    const result = await createAndSendToSoftPro(input, 'manual_entry');

    expect(softproCreateMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: false,
      fileNumber: '20021683-OCT',
      createdInSoftPro: true,
      submitLocked: true,
      error: softProCreatedDoNotReenter('20021683-OCT'),
    });
  });

  // The test above throws a plain Error. Production never does: Drizzle throws
  // a DrizzleQueryError with the Postgres error on `cause`. The recorder added
  // on 2026-09-09 read the wrapper and stored code/constraint/column null for
  // every failure that followed. This throws what production throws.
  it('records the Postgres code from cause when Drizzle wraps the failure', async () => {
    softproCreateMock.mockResolvedValue({ success: true, data: { orderNumber: '20022166-GLT' } });
    const pgError = Object.assign(new Error('value too long for type character varying(50)'), {
      code: '22001', routine: 'varchar',
    });
    returningMock.mockRejectedValue(new DrizzleQueryError(
      'insert into "order_properties" ("id", "order_id", "property_type") values (default, $1, $2)',
      [8687, 'Retail Stores (Personal Services, Photography, Travel)'],
      pgError,
    ));

    const result = await createAndSendToSoftPro(input, 'manual_entry');
    expect(result.submitLocked).toBe(true);

    const recorded = insertValuesMock.mock.calls
      .map(([values]) => values as { action?: string; meta?: Record<string, unknown> })
      .find((v) => v.action === 'order_create_local_failed');
    expect(recorded?.meta).toMatchObject({
      code: '22001',
      message: 'value too long for type character varying(50)',
      failedStatement: 'insert into order_properties',
    });
    // The statement and its parameters survive, for a reconcile to finish the write.
    expect(recorded?.meta?.sql).toContain('Retail Stores (Personal Services, Photography, Travel)');
  });

  // Gerard should not hear about a half-created order from the operator.
  it('queues the internal alert with the reason when the order row exists', async () => {
    softproCreateMock.mockResolvedValue({ success: true, data: { orderNumber: '20022166-GLT' } });
    returningMock.mockImplementation(async () => {
      ordersRows.value = [{ id: 8687 }];
      throw new DrizzleQueryError('insert into "order_properties" ("property_type") values ($1)', ['x'],
        Object.assign(new Error('value too long for type character varying(50)'), { code: '22001' }));
    });

    await createAndSendToSoftPro(input, 'manual_entry');

    const alert = insertValuesMock.mock.calls
      .map(([values]) => values as { eventType?: string; orderId?: number; payload?: Record<string, unknown> })
      .find((v) => v.eventType === 'order.create.local_failed');
    expect(alert?.orderId).toBe(8687);
    expect(alert?.payload?.subject).toBe('Hub order did not finish saving — 20022166-GLT');
    expect(String(alert?.payload?.html)).toContain('22001');
  });

  it('records the failure without an alert when no order row exists to open', async () => {
    softproCreateMock.mockResolvedValue({ success: true, data: { orderNumber: '20022166-GLT' } });
    returningMock.mockRejectedValue(new Error('connection reset'));

    await createAndSendToSoftPro(input, 'manual_entry');

    const values = insertValuesMock.mock.calls.map(([v]) => v as { action?: string; eventType?: string });
    expect(values.some((v) => v.action === 'order_create_local_failed')).toBe(true);
    expect(values.some((v) => v.eventType === 'order.create.local_failed')).toBe(false);
  });
});
