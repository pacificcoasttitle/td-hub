import { beforeEach, describe, expect, it, vi } from 'vitest';

type OrderRow = {
  id: number;
  escrowOfficerId: number | null;
  titleOfficerId: number | null;
  salesRepId: number | null;
};

type ContactRow = {
  id: number;
  email: string | null;
  fullName: string | null;
};

type PartyRow = {
  orderId: number;
  role: string;
  contactId: number | null;
  externalName: string | null;
  externalCompany: string | null;
  externalEmail: string | null;
};

const {
  contactsById,
  orderRows,
  partyRows,
} = vi.hoisted(() => {
  const contactsById = new Map<number, ContactRow>();
  const orderRows = new Map<number, OrderRow>();
  const partyRows: PartyRow[] = [];

  return {
    contactsById,
    orderRows,
    partyRows,
  };
});

type EqCondition = {
  type: 'eq';
  field: string;
  value: unknown;
};

type AndCondition = {
  type: 'and';
  conditions: Array<EqCondition | AndCondition>;
};

type QueryCondition = EqCondition | AndCondition;

function conditionValue(condition: QueryCondition | undefined, field: string): unknown {
  if (!condition) return undefined;
  if (condition.type === 'eq') {
    return condition.field === field ? condition.value : undefined;
  }

  for (const child of condition.conditions) {
    const value = conditionValue(child, field);
    if (value !== undefined) return value;
  }

  return undefined;
}

function selectRows(tableName: string, condition: QueryCondition | undefined) {
  if (tableName === 'orders') {
    const id = conditionValue(condition, 'orders.id');
    const row = typeof id === 'number' ? orderRows.get(id) : null;
    return row ? [row] : [];
  }

  if (tableName === 'contacts') {
    const id = conditionValue(condition, 'contacts.id');
    const row = typeof id === 'number' ? contactsById.get(id) : null;
    return row ? [{ email: row.email, fullName: row.fullName }] : [];
  }

  if (tableName === 'order_parties') {
    const orderId = conditionValue(condition, 'order_parties.order_id');
    const role = conditionValue(condition, 'order_parties.role');

    return partyRows
      .filter((row) => row.orderId === orderId && row.role === role)
      .map((row) => {
        const contact = row.contactId ? contactsById.get(row.contactId) : null;
        return {
          externalName: row.externalName,
          externalCompany: row.externalCompany,
          externalEmail: row.externalEmail,
          contactEmail: contact?.email ?? null,
          contactName: contact?.fullName ?? null,
        };
      });
  }

  return [];
}

vi.mock('drizzle-orm', () => ({
  and: (...conditions: QueryCondition[]) => ({ type: 'and', conditions }),
  eq: (field: string, value: unknown) => ({ type: 'eq', field, value }),
}));

vi.mock('@/lib/db/schema', () => ({
  contacts: {
    __table: 'contacts',
    id: 'contacts.id',
    email: 'contacts.email',
    fullName: 'contacts.full_name',
  },
  orderParties: {
    __table: 'order_parties',
    orderId: 'order_parties.order_id',
    role: 'order_parties.role',
    contactId: 'order_parties.contact_id',
    externalName: 'order_parties.external_name',
    externalCompany: 'order_parties.external_company',
    externalEmail: 'order_parties.external_email',
  },
  orders: {
    __table: 'orders',
    id: 'orders.id',
    escrowOfficerId: 'orders.escrow_officer_id',
    titleOfficerId: 'orders.title_officer_id',
    salesRepId: 'orders.sales_rep_id',
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: { __table: string }) => {
        const query = {
          leftJoin: vi.fn(() => query),
          where: vi.fn((condition: QueryCondition) => {
            const rows = selectRows(table.__table, condition);
            return {
              limit: vi.fn(async (count: number) => rows.slice(0, count)),
              then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => (
                Promise.resolve(rows).then(resolve, reject)
              ),
            };
          }),
        };

        return query;
      }),
    })),
  },
}));

import { resolvePrelimRecipients } from './prelim-recipient-resolution';

function addContact(row: ContactRow) {
  contactsById.set(row.id, row);
}

function addOrder(row: OrderRow) {
  orderRows.set(row.id, row);
}

describe('resolvePrelimRecipients', () => {
  beforeEach(() => {
    contactsById.clear();
    orderRows.clear();
    partyRows.splice(0, partyRows.length);
  });

  it('resolves internal escrow officer TO with sales rep CC only', async () => {
    addOrder({ id: 100, escrowOfficerId: 10, titleOfficerId: 11, salesRepId: 12 });
    addContact({ id: 10, email: 'eo@example.com', fullName: 'Escrow Officer' });
    addContact({ id: 11, email: 'title@example.com', fullName: 'Title Officer' });
    addContact({ id: 12, email: 'rep@example.com', fullName: 'Sales Rep' });

    const result = await resolvePrelimRecipients(100);

    expect(result.blocked).toBe(false);
    expect(result.to).toEqual({ email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' });
    expect(result.cc).toEqual([
      { email: 'rep@example.com', name: 'Sales Rep', role: 'sales_rep', source: 'sales_rep' },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('resolves an external escrow deal TO from the escrow_company party', async () => {
    addOrder({ id: 101, escrowOfficerId: null, titleOfficerId: null, salesRepId: 12 });
    addContact({ id: 12, email: 'rep@example.com', fullName: 'Sales Rep' });
    partyRows.push({
      orderId: 101,
      role: 'escrow_company',
      contactId: null,
      externalName: 'External Escrow',
      externalCompany: 'Outside Escrow Co',
      externalEmail: 'external@example.com',
    });

    const result = await resolvePrelimRecipients(101);

    expect(result.blocked).toBe(false);
    expect(result.to).toEqual({ email: 'external@example.com', name: 'External Escrow', role: 'escrow_company' });
    expect(result.cc).toEqual([
      { email: 'rep@example.com', name: 'Sales Rep', role: 'sales_rep', source: 'sales_rep' },
    ]);
  });

  it('blocks when no internal or external escrow recipient resolves', async () => {
    addOrder({ id: 102, escrowOfficerId: null, titleOfficerId: null, salesRepId: null });

    const result = await resolvePrelimRecipients(102);

    expect(result.blocked).toBe(true);
    expect(result.to).toBeNull();
    expect(result.cc).toEqual([]);
    expect(result.blockReason).toBe('No valid primary prelim recipient resolved');
  });

  it('blocks when the escrow officer email is invalid', async () => {
    addOrder({ id: 103, escrowOfficerId: 10, titleOfficerId: null, salesRepId: null });
    addContact({ id: 10, email: 'not-an-email', fullName: 'Escrow Officer' });

    const result = await resolvePrelimRecipients(103);

    expect(result.blocked).toBe(true);
    expect(result.to).toBeNull();
    expect(result.warnings).toMatchObject([
      { code: 'invalid_email', email: 'not-an-email', role: 'escrow_officer', source: 'primary' },
    ]);
  });

  it('warns and proceeds when the sales rep CC address is invalid', async () => {
    addOrder({ id: 104, escrowOfficerId: 10, titleOfficerId: null, salesRepId: 12 });
    addContact({ id: 10, email: 'eo@example.com', fullName: 'Escrow Officer' });
    addContact({ id: 12, email: 'bad-address', fullName: 'Sales Rep' });

    const result = await resolvePrelimRecipients(104);

    expect(result.blocked).toBe(false);
    expect(result.to).toEqual({ email: 'eo@example.com', name: 'Escrow Officer', role: 'escrow_officer' });
    expect(result.cc).toEqual([]);
    expect(result.warnings).toMatchObject([
      { code: 'invalid_email', email: 'bad-address', role: 'sales_rep', source: 'sales_rep' },
    ]);
  });

  it('dedupes TO from CC case-insensitively', async () => {
    addOrder({ id: 105, escrowOfficerId: 10, titleOfficerId: 11, salesRepId: 12 });
    addContact({ id: 10, email: 'Primary@example.com', fullName: 'Escrow Officer' });
    addContact({ id: 11, email: 'primary@example.com', fullName: 'Title Rep' });
    addContact({ id: 12, email: 'primary@example.com', fullName: 'Sales Rep' });

    const result = await resolvePrelimRecipients(105, [
      { email: 'primary@example.com', name: 'Operator Add', role: 'operator' },
    ]);

    expect(result.blocked).toBe(false);
    expect(result.to).toEqual({ email: 'primary@example.com', name: 'Escrow Officer', role: 'escrow_officer' });
    expect(result.cc).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
