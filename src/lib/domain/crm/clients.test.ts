import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, query, getSalesScopedContactIdsMock, insertCalls, txInsertCalls } = vi.hoisted(() => {
  const query = { rows: [] as unknown[][] };
  const insertCalls = [] as unknown[];
  const txInsertCalls = [] as unknown[];

  const builder: Record<string, unknown> = {};
  const chain = (impl?: (...args: unknown[]) => void) => vi.fn((...args: unknown[]) => {
    impl?.(...args);
    return builder;
  });
  Object.assign(builder, {
    from: chain(),
    where: chain(),
    orderBy: chain(),
    limit: chain(),
    offset: chain(),
    innerJoin: chain(),
    leftJoin: chain(),
    values: chain((v) => insertCalls.push(v)),
    set: chain(),
    returning: vi.fn(async () => query.rows.shift() ?? []),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(query.rows.shift() ?? []).then(resolve, reject),
  });

  const txMock = {
    insert: vi.fn(() => ({
      values: vi.fn(async (v: unknown) => { txInsertCalls.push(v); }),
    })),
  };

  const dbMock = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    transaction: vi.fn(async (fn: (tx: typeof txMock) => Promise<void>) => fn(txMock)),
  };

  return { dbMock, query, getSalesScopedContactIdsMock: vi.fn(), insertCalls, txInsertCalls };
});

vi.mock('@/lib/db/client', () => ({ db: dbMock }));

vi.mock('@/lib/security/permissions', () => ({
  getSalesScopedContactIds: getSalesScopedContactIdsMock,
  isSalesScopedRole: (role: string) => role === 'sales_rep' || role === 'sales_manager',
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  or: vi.fn((...conditions) => ({ type: 'or', conditions })),
  eq: vi.fn((left, right) => ({ type: 'eq', left, right })),
  ilike: vi.fn((left, right) => ({ type: 'ilike', left, right })),
  inArray: vi.fn((left, values) => ({ type: 'inArray', left, values })),
  desc: vi.fn((field) => ({ type: 'desc', field })),
  exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values }),
    {},
  ),
}));

vi.mock('@/lib/db/schema', () => {
  const table = (name: string, cols: string[]) =>
    Object.fromEntries(cols.map((c) => [c, `${name}.${c}`]));
  return {
    crmClients: table('crm_clients', ['id', 'ownerProfileId', 'name', 'company', 'email', 'phone', 'contactId', 'createdAt', 'updatedAt']),
    crmClientNotes: table('crm_client_notes', ['id', 'clientId', 'authorProfileId', 'body', 'createdAt']),
    contacts: table('contacts', ['id', 'fullName', 'companyName', 'email', 'isActive']),
    profiles: table('profiles', ['id', 'contactId', 'displayName']),
    orders: table('orders', ['id', 'fileNumber', 'operationalStatus', 'transactionType', 'salesRepId', 'clientContactId', 'openedAt', 'closedAt', 'salesPrice']),
    orderParties: table('order_parties', ['id', 'orderId', 'contactId']),
  };
});

import {
  CrmAccessError,
  buildClientsCsv,
  composeBusinessSummaries,
  createClient,
  deleteNote,
  getClientDetail,
  resolveCrmScope,
  triageImportRows,
  updateClient,
  importClients,
} from './clients';
import type { SessionUser } from '@/lib/security/auth';

function session(role: string, contactId: number | null, id = 'profile-1'): SessionUser {
  return {
    id,
    email: 'user@example.com',
    role,
    displayName: 'User One',
    branchId: null,
    contactId,
  } as SessionUser;
}

async function expectCrmError(promise: Promise<unknown>, status: number) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(CrmAccessError);
  expect((err as CrmAccessError).status).toBe(status);
}

beforeEach(() => {
  vi.clearAllMocks();
  query.rows = [];
  insertCalls.length = 0;
  txInsertCalls.length = 0;
  getSalesScopedContactIdsMock.mockResolvedValue([]);
});

// ─── Scope resolution ───────────────────────────────────────────────────────

describe('resolveCrmScope', () => {
  it('rejects non-sales roles with 404 so the API does not exist for them', async () => {
    for (const role of ['admin', 'super_admin', 'cs_admin', 'client', 'escrow_officer', 'title_officer']) {
      await expectCrmError(resolveCrmScope(session(role, 10)), 404);
    }
  });

  it('scopes a sales rep to their own list only', async () => {
    const scope = await resolveCrmScope(session('sales_rep', 10, 'rep-profile'));
    expect(scope.visibleOwnerProfileIds).toEqual(['rep-profile']);
    expect(scope.ownerContactIdByProfile.get('rep-profile')).toBe(10);
  });

  it('rejects a sales rep requesting another rep with 404 (cross-rep)', async () => {
    await expectCrmError(resolveCrmScope(session('sales_rep', 10), '20'), 404);
  });

  it('allows a sales rep to pass their own contact id as repId', async () => {
    const scope = await resolveCrmScope(session('sales_rep', 10, 'rep-profile'), '10');
    expect(scope.visibleOwnerProfileIds).toEqual(['rep-profile']);
  });

  it('defaults a manager with no repId to their own list', async () => {
    getSalesScopedContactIdsMock.mockResolvedValue([10, 20, 30]);
    const scope = await resolveCrmScope(session('sales_manager', 10, 'mgr-profile'));
    expect(scope.visibleOwnerProfileIds).toEqual(['mgr-profile']);
  });

  it('expands manager repId=all to self plus managed rep profiles', async () => {
    getSalesScopedContactIdsMock.mockResolvedValue([10, 20, 30]);
    query.rows.push([
      { id: 'mgr-profile', contactId: 10 },
      { id: 'rep-b', contactId: 20 },
      { id: 'rep-c', contactId: 30 },
    ]);
    const scope = await resolveCrmScope(session('sales_manager', 10, 'mgr-profile'), 'all');
    expect(scope.visibleOwnerProfileIds.sort()).toEqual(['mgr-profile', 'rep-b', 'rep-c']);
    expect(scope.ownerContactIdByProfile.get('rep-b')).toBe(20);
  });

  it('scopes manager repId=<rep> to that rep only when managed', async () => {
    getSalesScopedContactIdsMock.mockResolvedValue([10, 20]);
    query.rows.push([
      { id: 'mgr-profile', contactId: 10 },
      { id: 'rep-b', contactId: 20 },
    ]);
    const scope = await resolveCrmScope(session('sales_manager', 10, 'mgr-profile'), '20');
    expect(scope.visibleOwnerProfileIds).toEqual(['rep-b']);
  });

  it('rejects a manager requesting an unmanaged rep with 404', async () => {
    getSalesScopedContactIdsMock.mockResolvedValue([10, 20]);
    await expectCrmError(resolveCrmScope(session('sales_manager', 10), '99'), 404);
  });

  it('rejects a malformed repId with 400', async () => {
    getSalesScopedContactIdsMock.mockResolvedValue([10]);
    query.rows.push([]);
    await expectCrmError(resolveCrmScope(session('sales_manager', 10), 'abc'), 400);
  });
});

// ─── Create + dedupe ────────────────────────────────────────────────────────

describe('createClient', () => {
  it('rejects a duplicate email in the same owner list with 409', async () => {
    query.rows.push([{ id: 7 }]); // duplicate lookup hit
    await expectCrmError(
      createClient(session('sales_rep', 10), { name: 'Jane', email: 'Jane@KW.com' }),
      409,
    );
  });

  it('creates a client in the caller own list with normalized email', async () => {
    query.rows.push([]); // duplicate lookup: none
    query.rows.push([{ id: 1, ownerProfileId: 'profile-1', name: 'Jane Smith', email: 'jane@kw.com', contactId: null }]); // insert returning
    query.rows.push([]); // suggestion: email
    query.rows.push([]); // suggestion: name

    const result = await createClient(session('sales_rep', 10), {
      name: '  Jane Smith  ',
      email: 'Jane@KW.com',
      company: '',
    });

    expect(insertCalls[0]).toMatchObject({
      ownerProfileId: 'profile-1',
      name: 'Jane Smith',
      email: 'jane@kw.com',
      company: null,
    });
    expect(result.client.canEdit).toBe(true);
    expect(result.suggestions).toEqual([]);
  });

  it('is closed to non-sales roles (404)', async () => {
    await expectCrmError(createClient(session('admin', null), { name: 'X' }), 404);
  });
});

// ─── Manager read-only + cross-rep writes ───────────────────────────────────

describe('write authorization', () => {
  it('lets a manager SEE a rep client but not edit it (403)', async () => {
    getSalesScopedContactIdsMock.mockResolvedValue([10, 20]);
    query.rows.push([{ id: 'rep-b', contactId: 20 }]); // team profiles for scope=all
    query.rows.push([{ id: 5, ownerProfileId: 'rep-b', name: 'Jane' }]); // visible client row

    await expectCrmError(
      updateClient(session('sales_manager', 10, 'mgr-profile'), 5, { name: 'New Name' }),
      403,
    );
  });

  it('404s a rep touching another rep client (invisible, not forbidden)', async () => {
    query.rows.push([]); // client lookup in own scope: no row
    await expectCrmError(
      updateClient(session('sales_rep', 10, 'rep-a'), 5, { name: 'X' }),
      404,
    );
  });

  it('blocks deleting a note authored by someone else (403)', async () => {
    query.rows.push([{ id: 5, ownerProfileId: 'rep-a', name: 'Jane' }]); // owned client
    query.rows.push([{ id: 9, authorProfileId: 'someone-else' }]); // note row

    await expectCrmError(deleteNote(session('sales_rep', 10, 'rep-a'), 5, 9), 403);
  });
});

// ─── Detail visibility ──────────────────────────────────────────────────────

describe('getClientDetail', () => {
  it('404s when the client is outside the caller scope', async () => {
    query.rows.push([]); // no visible row
    await expectCrmError(getClientDetail(session('sales_rep', 10), 42), 404);
  });
});

// ─── Business summary composition (pure) ────────────────────────────────────

describe('composeBusinessSummaries', () => {
  const d = (s: string) => new Date(s);

  it('dedupes an order matched through both client_contact_id and order_parties', () => {
    const summaries = composeBusinessSummaries(
      [{ id: 1, contactId: 500, ownerContactId: 10 }],
      [
        { orderId: 100, salesRepId: 10, contactId: 500, openedAt: d('2026-01-05'), closedAt: d('2026-02-01') },
        { orderId: 100, salesRepId: 10, contactId: 500, openedAt: d('2026-01-05'), closedAt: d('2026-02-01') },
        { orderId: 101, salesRepId: 10, contactId: 500, openedAt: d('2026-03-01'), closedAt: null },
      ],
    );
    expect(summaries.get(1)).toEqual({
      orderCount: 2,
      lastOpenedAt: d('2026-03-01'),
      lastClosedAt: d('2026-02-01'),
    });
  });

  it('only counts orders where the sales rep is the client OWNER, not another rep', () => {
    const summaries = composeBusinessSummaries(
      [{ id: 1, contactId: 500, ownerContactId: 10 }],
      [
        { orderId: 100, salesRepId: 99, contactId: 500, openedAt: d('2026-01-05'), closedAt: null },
      ],
    );
    expect(summaries.has(1)).toBe(false);
  });

  it('skips unlinked clients and owners with no rep contact', () => {
    const summaries = composeBusinessSummaries(
      [
        { id: 1, contactId: null, ownerContactId: 10 },
        { id: 2, contactId: 500, ownerContactId: null },
      ],
      [
        { orderId: 100, salesRepId: 10, contactId: 500, openedAt: d('2026-01-05'), closedAt: null },
      ],
    );
    expect(summaries.size).toBe(0);
  });
});

// ─── Import triage (pure) + import transaction ──────────────────────────────

describe('triageImportRows', () => {
  it('classifies added, duplicate, and error rows with first-occurrence-wins', () => {
    const { toInsert, results } = triageImportRows(
      [
        { name: 'Jane', email: 'jane@kw.com' },
        { name: 'Jane Again', email: 'JANE@kw.com' },      // dup within file
        { name: '', email: 'no-name@x.com' },              // missing name
        { name: 'Bad Email', email: 'not-an-email' },      // invalid email
        { name: 'Already There', email: 'existing@x.com' }, // dup vs existing list
        { name: 'No Email' },                               // fine without email
      ],
      new Set(['existing@x.com']),
    );

    expect(results.map((r) => r.status)).toEqual([
      'added', 'skipped_duplicate', 'error', 'error', 'skipped_duplicate', 'added',
    ]);
    expect(toInsert).toHaveLength(2);
    expect(toInsert[0]).toMatchObject({ name: 'Jane', email: 'jane@kw.com' });
    expect(toInsert[1]).toMatchObject({ name: 'No Email', email: null });
  });
});

describe('importClients', () => {
  it('rejects more than 1000 rows with a friendly 400', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ name: `Person ${i}` }));
    await expectCrmError(importClients(session('sales_rep', 10), rows), 400);
  });

  it('inserts triaged rows into the caller own list inside a transaction', async () => {
    query.rows.push([{ email: 'existing@x.com' }]); // owner's existing emails

    const result = await importClients(session('sales_rep', 10), [
      { name: 'Jane', email: 'jane@kw.com' },
      { name: 'Dup', email: 'existing@x.com' },
    ]);

    expect(result).toMatchObject({ added: 1, skipped: 1, errors: 0 });
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(txInsertCalls[0]).toEqual([
      expect.objectContaining({ name: 'Jane', email: 'jane@kw.com', ownerProfileId: 'profile-1' }),
    ]);
  });
});

// ─── CSV builder (pure) ─────────────────────────────────────────────────────

describe('buildClientsCsv', () => {
  it('escapes commas and quotes and emits CRLF lines', () => {
    const csv = buildClientsCsv([
      {
        name: 'Smith, Jane',
        company: 'Keller "KW" Williams',
        email: 'jane@kw.com',
        phone: null,
        createdAt: new Date('2026-07-29T10:00:00Z'),
      },
    ]);
    expect(csv).toBe(
      'name,company,email,phone,created\r\n' +
      '"Smith, Jane","Keller ""KW"" Williams",jane@kw.com,,2026-07-29\r\n',
    );
  });
});
