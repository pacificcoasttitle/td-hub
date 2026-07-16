import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  orderRows,
  snapshotRows,
  getOrderDetailsMock,
  processOrderDetailMock,
  enrichSingleOrderMock,
  loadSalesRepsMock,
  loadTitleOfficersMock,
  loadEscrowOfficersMock,
} = vi.hoisted(() => ({
  orderRows: [] as Array<{ id: number; fileNumber: string }>,
  snapshotRows: [] as Array<Record<string, unknown>>,
  getOrderDetailsMock: vi.fn(),
  processOrderDetailMock: vi.fn(),
  enrichSingleOrderMock: vi.fn(),
  loadSalesRepsMock: vi.fn(),
  loadTitleOfficersMock: vi.fn(),
  loadEscrowOfficersMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
}));

vi.mock('@/lib/db/schema', () => ({
  orders: {
    __table: 'orders',
    id: 'orders.id',
    fileNumber: 'orders.file_number',
    operationalStatus: 'orders.operational_status',
    softproStatus: 'orders.softpro_status',
    transactionType: 'orders.transaction_type',
    productType: 'orders.product_type',
    orderType: 'orders.order_type',
    salesPrice: 'orders.sales_price',
    salesRepId: 'orders.sales_rep_id',
    titleOfficerId: 'orders.title_officer_id',
    escrowOfficerId: 'orders.escrow_officer_id',
  },
  orderProperties: {
    __table: 'order_properties',
    orderId: 'order_properties.order_id',
    address: 'order_properties.address',
    city: 'order_properties.city',
    state: 'order_properties.state',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: { __table?: string }) => {
        if (table.__table === 'orders') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(async () => orderRows),
            })),
            leftJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(async () => {
                  const next = snapshotRows.shift();
                  return next ? [next] : [];
                }),
              })),
            })),
          };
        }
        return {
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => {
                const next = snapshotRows.shift();
                return next ? [next] : [];
              }),
            })),
          })),
        };
      }),
    })),
  },
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getOrderDetails: getOrderDetailsMock,
}));

vi.mock('@/lib/domain/orders/process-detail', () => ({
  processOrderDetail: processOrderDetailMock,
  loadSalesReps: loadSalesRepsMock,
  loadTitleOfficers: loadTitleOfficersMock,
  loadEscrowOfficers: loadEscrowOfficersMock,
}));

vi.mock('@/lib/jobs/handlers/enrich-orders', () => ({
  enrichSingleOrder: enrichSingleOrderMock,
}));

import { resyncFromSoftPro } from './resync-from-softpro';

describe('resyncFromSoftPro', () => {
  beforeEach(() => {
    orderRows.splice(0, orderRows.length, { id: 42, fileNumber: '20018881-OCT' });
    snapshotRows.splice(0, snapshotRows.length);
    getOrderDetailsMock.mockReset();
    processOrderDetailMock.mockReset();
    enrichSingleOrderMock.mockReset();
    loadSalesRepsMock.mockReset().mockResolvedValue([]);
    loadTitleOfficersMock.mockReset().mockResolvedValue([]);
    loadEscrowOfficersMock.mockReset().mockResolvedValue([]);
  });

  it('re-pulls SoftPro details, upserts via processOrderDetail, and reports real field changes', async () => {
    snapshotRows.push(
      {
        operationalStatus: 'open',
        softproStatus: 'open',
        transactionType: 'Purchase',
        productType: null,
        orderType: null,
        salesPrice: '100000.00',
        salesRepId: 1,
        titleOfficerId: 2,
        escrowOfficerId: 3,
        address: '1 Main St',
        city: 'Irvine',
        state: 'CA',
      },
      {
        operationalStatus: 'in_process',
        softproStatus: 'in process',
        transactionType: 'Purchase',
        productType: null,
        orderType: null,
        salesPrice: '125000.00',
        salesRepId: 1,
        titleOfficerId: 2,
        escrowOfficerId: 3,
        address: '1 Main St',
        city: 'Irvine',
        state: 'CA',
      },
    );

    const detail = {
      OrderNumber: '20018881-OCT',
      OrderStatus: 'In Process',
      SalesPrice: '125000',
    };
    getOrderDetailsMock.mockResolvedValue({ success: true, data: [detail] });
    processOrderDetailMock.mockResolvedValue(undefined);
    enrichSingleOrderMock.mockResolvedValue({
      success: true,
      orderId: 42,
      fileNumber: '20018881-OCT',
      resolved: {},
      unresolved: [],
      partiesWritten: 0,
      contactsEmptyConfirmed: false,
      outcome: 'empty_confirmed',
    });

    const result = await resyncFromSoftPro(42);

    expect(getOrderDetailsMock).toHaveBeenCalledWith({
      dateFrom: '',
      orderNumber: '20018881-OCT',
      orderId: 42,
    });
    expect(processOrderDetailMock).toHaveBeenCalledWith(detail, expect.objectContaining({
      preserveExistingOnEmpty: true,
    }));
    expect(enrichSingleOrderMock).toHaveBeenCalledWith(42);
    expect(result).toMatchObject({
      success: true,
      updated: true,
      fileNumber: '20018881-OCT',
    });
    expect(result.changes).toEqual(expect.arrayContaining([
      { field: 'operationalStatus', oldValue: 'open', newValue: 'in_process' },
      { field: 'salesPrice', oldValue: '100000.00', newValue: '125000.00' },
    ]));
  });

  it('returns success with updated=false when SoftPro re-pull finds no field changes', async () => {
    const snap = {
      operationalStatus: 'open',
      softproStatus: 'open',
      transactionType: 'Purchase',
      productType: null,
      orderType: null,
      salesPrice: '100000.00',
      salesRepId: 1,
      titleOfficerId: 2,
      escrowOfficerId: 3,
      address: '1 Main St',
      city: 'Irvine',
      state: 'CA',
    };
    snapshotRows.push(snap, { ...snap });

    getOrderDetailsMock.mockResolvedValue({
      success: true,
      data: [{ OrderNumber: '20018881-OCT', OrderStatus: 'Open' }],
    });
    processOrderDetailMock.mockResolvedValue(undefined);
    enrichSingleOrderMock.mockResolvedValue({
      success: true,
      orderId: 42,
      fileNumber: '20018881-OCT',
      resolved: {},
      unresolved: [],
      partiesWritten: 0,
      contactsEmptyConfirmed: false,
      outcome: 'empty_confirmed',
    });

    const result = await resyncFromSoftPro(42);

    expect(processOrderDetailMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ preserveExistingOnEmpty: true }),
    );
    expect(result).toMatchObject({ success: true, updated: false, changes: [] });
  });

  it('does not report fake success when SoftPro returns no details', async () => {
    snapshotRows.push({
      operationalStatus: 'open',
      softproStatus: 'open',
      transactionType: null,
      productType: null,
      orderType: null,
      salesPrice: null,
      salesRepId: null,
      titleOfficerId: null,
      escrowOfficerId: null,
      address: null,
      city: null,
      state: null,
    });
    getOrderDetailsMock.mockResolvedValue({
      success: false,
      error: { message: 'SoftPro unavailable' },
    });

    const result = await resyncFromSoftPro(42);

    expect(processOrderDetailMock).not.toHaveBeenCalled();
    expect(enrichSingleOrderMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      updated: false,
      error: 'SoftPro unavailable',
    });
  });
});
