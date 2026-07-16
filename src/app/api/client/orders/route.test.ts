import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAccessibleOrderIdsMock,
  getSessionMock,
  orderRows,
  countRows,
} = vi.hoisted(() => ({
  getAccessibleOrderIdsMock: vi.fn(),
  getSessionMock: vi.fn(),
  orderRows: [] as Array<Record<string, unknown>>,
  countRows: [] as Array<{ count: number }>,
}));

function query(result: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(async () => result),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    ),
  };
  return chain;
}

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  desc: (field: unknown) => ({ op: 'desc', field }),
  eq: (field: unknown, value: unknown) => ({ op: 'eq', field, value }),
  ilike: (field: unknown, value: unknown) => ({ op: 'ilike', field, value }),
  inArray: (field: unknown, values: unknown[]) => ({ op: 'inArray', field, values }),
  or: (...conditions: unknown[]) => ({ op: 'or', conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join('?'), values }),
}));

vi.mock('drizzle-orm/pg-core', () => ({
  alias: (table: unknown, name: string) => ({ table, __table: name, displayName: `${name}.display_name` }),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/client-scope', () => ({
  getAccessibleOrderIds: getAccessibleOrderIdsMock,
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    __table: 'contacts',
    id: 'contacts.id',
    fullName: 'contacts.full_name',
    officerName: 'contacts.officer_name',
    firstName: 'contacts.first_name',
    lastName: 'contacts.last_name',
    companyName: 'contacts.company_name',
    email: 'contacts.email',
  },
  orderProperties: {
    __table: 'order_properties',
    orderId: 'order_properties.order_id',
    address: 'order_properties.address',
    city: 'order_properties.city',
    state: 'order_properties.state',
    zip: 'order_properties.zip',
    fullAddress: 'order_properties.full_address',
  },
  orders: {
    __table: 'orders',
    id: 'orders.id',
    fileNumber: 'orders.file_number',
    operationalStatus: 'orders.operational_status',
    transactionType: 'orders.transaction_type',
    orderType: 'orders.order_type',
    productType: 'orders.product_type',
    openedAt: 'orders.opened_at',
    closedAt: 'orders.closed_at',
    createdBy: 'orders.created_by',
    clientContactId: 'orders.client_contact_id',
    salesRepId: 'orders.sales_rep_id',
  },
  profiles: {
    __table: 'profiles',
    id: 'profiles.id',
    displayName: 'profiles.display_name',
  },
}));

vi.mock('@/lib/domain/orders/list-row', () => ({
  projectListRow: vi.fn((source: {
    id: number;
    fileNumber: string;
    operationalStatus: string;
    transactionType: string | null;
    property: { address: string | null; city: string | null; state: string | null };
    clientContact?: { fullName?: string | null; companyName?: string | null };
  }) => ({
    id: source.id,
    fileNumber: source.fileNumber,
    operationalStatus: source.operationalStatus,
    transactionType: source.transactionType,
    type: source.transactionType ?? '—',
    address: source.property.address,
    city: source.property.city,
    state: source.property.state,
    propertyStreet: source.property.address,
    propertyCity: source.property.city,
    propertyState: source.property.state,
    clientName: source.clientContact?.fullName ?? null,
    clientCompany: source.clientContact?.companyName ?? null,
  })),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      if ('count' in selection) return query(countRows);
      return query(orderRows);
    }),
  },
}));

import { GET } from './route';

function request(url = 'http://localhost/api/client/orders?page=1&pageSize=10') {
  return { nextUrl: new URL(url) } as never;
}

describe('GET /api/client/orders', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    getAccessibleOrderIdsMock.mockResolvedValue([100]);
    orderRows.splice(0, orderRows.length, {
      id: 100,
      fileNumber: '20018881-OCT',
      operationalStatus: 'open',
      transactionType: 'purchase',
      openedAt: new Date('2026-07-15T18:00:00.000Z'),
      address: '5792 Adobe Rd',
      city: 'Twentynine Palms',
      state: 'CA',
      createdByName: 'Client User',
    });
    countRows.splice(0, countRows.length, { count: 26 });
    vi.clearAllMocks();
  });

  it('returns both dashboard and table address shapes with totalPages', async () => {
    const response = await GET(request('http://localhost/api/client/orders?page=2&pageSize=10'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      total: 26,
      page: 2,
      pageSize: 10,
      totalPages: 3,
    });
    expect(body.orders[0]).toMatchObject({
      address: '5792 Adobe Rd',
      city: 'Twentynine Palms',
      state: 'CA',
      propertyStreet: '5792 Adobe Rd',
      propertyCity: 'Twentynine Palms',
      propertyState: 'CA',
    });
  });

  it('returns totalPages for clients with no accessible orders', async () => {
    getAccessibleOrderIdsMock.mockResolvedValueOnce([]);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      orders: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
    });
  });
});
