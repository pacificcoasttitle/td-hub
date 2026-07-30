import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, query, getSalesScopedContactIdsMock, insertCalls, txInsertCalls, setCalls } = vi.hoisted(() => {
  const query = { rows: [] as unknown[][] };
  const insertCalls = [] as unknown[];
  const txInsertCalls = [] as unknown[];
  const setCalls = [] as Record<string, unknown>[];

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
    set: chain((v) => setCalls.push(v as Record<string, unknown>)),
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

  return { dbMock, query, getSalesScopedContactIdsMock: vi.fn(), insertCalls, txInsertCalls, setCalls };
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
  notInArray: vi.fn((left, values) => ({ type: 'notInArray', left, values })),
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
    contacts: table('contacts', ['id', 'fullName', 'companyName', 'email', 'phone', 'isActive']),
    profiles: table('profiles', ['id', 'contactId', 'displayName']),
    orders: table('orders', ['id', 'fileNumber', 'operationalStatus', 'transactionType', 'salesRepId', 'clientContactId', 'openedAt', 'closedAt', 'salesPrice']),
    orderParties: table('order_parties', ['id', 'orderId', 'contactId', 'role']),
  };
});

import {
  CrmAccessError,
  addClientsFromTransactions,
  buildClientsCsv,
  composeBusinessSummaries,
  composeTransactionClientSuggestions,
  createClient,
  isGoneQuiet,
  QUIET_AFTER_MONTHS,
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
  setCalls.length = 0;
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
  const jane = {
    id: 1,
    name: 'Smith, Jane',
    company: 'Keller "KW" Williams',
    email: 'jane@kw.com',
    phone: null,
    createdAt: new Date('2026-07-29T10:00:00Z'),
  };

  it('escapes commas and quotes and emits CRLF lines', () => {
    expect(buildClientsCsv([jane])).toBe(
      'name,company,email,phone,created,note,note_author,note_date\r\n' +
      '"Smith, Jane","Keller ""KW"" Williams",jane@kw.com,,2026-07-29,,,\r\n',
    );
  });

  it('emits one row per note, repeating the client columns', () => {
    const csv = buildClientsCsv([jane], [
      { clientId: 1, body: 'Prefers texts', authorName: 'Gerardo H.', createdAt: new Date('2026-07-20T10:00:00Z') },
      { clientId: 1, body: 'Met at the mixer, said "hi"', authorName: 'Gerardo H.', createdAt: new Date('2026-06-02T10:00:00Z') },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 notes
    expect(lines[1]).toContain('Prefers texts,Gerardo H.,2026-07-20');
    expect(lines[2]).toContain('"Met at the mixer, said ""hi""",Gerardo H.,2026-06-02');
    expect(lines[2]).toContain('"Smith, Jane"'); // client columns repeat
  });

  it('keeps clients with no notes, with empty note columns', () => {
    const csv = buildClientsCsv(
      [jane, { ...jane, id: 2, name: 'Marcus', company: null, email: null }],
      [{ clientId: 1, body: 'note', authorName: null, createdAt: new Date('2026-07-20T10:00:00Z') }],
    );
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('Marcus,,,,2026-07-29,,,');
  });
});

describe('composeTransactionClientSuggestions', () => {
  const contactRows = [
    { id: 10, fullName: 'Jane Smith', companyName: 'KW', email: 'jane@kw.com', phone: '555' },
    { id: 11, fullName: 'Marcus Lee', companyName: 'Compass', email: 'marcus@c.com', phone: null },
    { id: 12, fullName: 'Dana Ortiz', companyName: 'eXp', email: 'dana@exp.com', phone: null },
  ];
  const d = (s: string) => new Date(s);

  it('counts distinct orders, merges roles, and ranks by business volume', () => {
    const out = composeTransactionClientSuggestions(
      [
        // Jane on the same order twice (client + listing agent) — one order.
        { orderId: 1, contactId: 10, openedAt: d('2026-05-01'), role: 'client' },
        { orderId: 1, contactId: 10, openedAt: d('2026-05-01'), role: 'listing_agent' },
        { orderId: 2, contactId: 10, openedAt: d('2026-06-01'), role: 'client' },
        // Marcus on three orders.
        { orderId: 3, contactId: 11, openedAt: d('2026-01-01'), role: 'buyer_agent' },
        { orderId: 4, contactId: 11, openedAt: d('2026-02-01'), role: 'buyer_agent' },
        { orderId: 5, contactId: 11, openedAt: d('2026-03-01'), role: 'buyer_agent' },
      ],
      contactRows, new Set(), new Set(),
    );

    expect(out.map(s => [s.contactId, s.orderCount])).toEqual([[11, 3], [10, 2]]);
    expect(out[1].roles).toEqual(['client', 'listing_agent']);
    expect(out[1].lastOrderAt).toEqual(d('2026-06-01'));
  });

  it('excludes contacts already linked in the rep list', () => {
    const out = composeTransactionClientSuggestions(
      [
        { orderId: 1, contactId: 10, openedAt: d('2026-05-01'), role: 'client' },
        { orderId: 2, contactId: 11, openedAt: d('2026-05-01'), role: 'client' },
      ],
      contactRows, new Set([10]), new Set(),
    );
    expect(out.map(s => s.contactId)).toEqual([11]);
  });

  it('excludes contacts whose email is already in the rep list, case-insensitively', () => {
    const out = composeTransactionClientSuggestions(
      [
        { orderId: 1, contactId: 10, openedAt: d('2026-05-01'), role: 'client' },
        { orderId: 2, contactId: 12, openedAt: d('2026-05-01'), role: 'client' },
      ],
      contactRows, new Set(), new Set(['jane@kw.com']),
    );
    expect(out.map(s => s.contactId)).toEqual([12]);
  });

  it('excludes consumer roles — the list is for business sources (spec §1)', () => {
    const out = composeTransactionClientSuggestions(
      [
        { orderId: 1, contactId: 10, openedAt: d('2026-05-01'), role: 'buyer' },
        { orderId: 2, contactId: 11, openedAt: d('2026-05-01'), role: 'seller' },
        { orderId: 3, contactId: 12, openedAt: d('2026-05-01'), role: 'borrower' },
      ],
      contactRows, new Set(), new Set(),
    );
    expect(out).toEqual([]);
  });

  it('keeps a contact who is a consumer on one file but a business source on another', () => {
    // An agent who also bought a house should still surface — as an agent,
    // and the consumer order must not inflate their count.
    const out = composeTransactionClientSuggestions(
      [
        { orderId: 1, contactId: 10, openedAt: d('2026-01-01'), role: 'buyer' },
        { orderId: 2, contactId: 10, openedAt: d('2026-05-01'), role: 'listing_agent' },
      ],
      contactRows, new Set(), new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0].orderCount).toBe(1);
    expect(out[0].roles).toEqual(['listing_agent']);
  });

  it('keeps every business-source role', () => {
    const roles = ['client', 'listing_agent', 'buyer_agent', 'lender', 'lender_contact', 'escrow_company', 'other'];
    const out = composeTransactionClientSuggestions(
      roles.map((role, i) => ({ orderId: i + 1, contactId: 10, openedAt: d('2026-05-01'), role })),
      contactRows, new Set(), new Set(),
    );
    expect(out[0].roles).toEqual([...roles].sort());
    expect(out[0].orderCount).toBe(roles.length);
  });

  it('ignores null contact ids and contacts with no synced row', () => {
    const out = composeTransactionClientSuggestions(
      [
        { orderId: 1, contactId: null, openedAt: d('2026-05-01'), role: 'client' },
        { orderId: 2, contactId: 999, openedAt: d('2026-05-01'), role: 'client' },
      ],
      contactRows, new Set(), new Set(),
    );
    expect(out).toEqual([]);
  });
});

// ─── "Gone quiet" insight ───────────────────────────────────────────────────

describe('isGoneQuiet', () => {
  const NOW = new Date('2026-07-30T12:00:00Z');
  const summary = (orderCount: number, lastOpenedAt: Date | null) =>
    ({ orderCount, lastOpenedAt, lastClosedAt: null });

  it('flags a client with prior business and no recent order', () => {
    expect(isGoneQuiet(summary(4, new Date('2026-01-15')), NOW)).toBe(true);
  });

  it('does not flag a client with a recent order', () => {
    expect(isGoneQuiet(summary(4, new Date('2026-07-01')), NOW)).toBe(false);
  });

  it('never flags an unlinked client (no summary at all)', () => {
    expect(isGoneQuiet(null, NOW)).toBe(false);
    expect(isGoneQuiet(undefined, NOW)).toBe(false);
  });

  it('never flags a client with no prior business', () => {
    expect(isGoneQuiet(summary(0, null), NOW)).toBe(false);
    expect(isGoneQuiet(summary(0, new Date('2020-01-01')), NOW)).toBe(false);
  });

  it('does not flag when the last order date is unknown', () => {
    expect(isGoneQuiet(summary(3, null), NOW)).toBe(false);
  });

  it('uses the shared threshold and is stable right at the boundary', () => {
    expect(QUIET_AFTER_MONTHS).toBe(3);
    const cutoff = new Date(NOW); cutoff.setMonth(cutoff.getMonth() - QUIET_AFTER_MONTHS);
    // exactly at the cutoff is not yet quiet; a moment earlier is
    expect(isGoneQuiet(summary(1, cutoff), NOW)).toBe(false);
    expect(isGoneQuiet(summary(1, new Date(cutoff.getTime() - 1000)), NOW)).toBe(true);
  });
});

// ─── Type derivation on link (suggest, never override) ──────────────────────

describe('updateClient — derive type on link', () => {
  const rep = session('sales_rep', 7, 'rep-a');

  /** Queue the query results updateClient consumes, in order. */
  function queueLink(existingType: string | null, roles: string[]) {
    query.rows.push([{ id: 5, ownerProfileId: 'rep-a', name: 'Jane', type: existingType }]); // owned client
    query.rows.push([{ id: 42 }]);                                    // contact exists
    query.rows.push(roles.map((role) => ({ role })));                 // party roles on caller's orders
    query.rows.push([{ id: 5, ownerProfileId: 'rep-a', name: 'Jane' }]); // update ... returning
  }

  it('fills type from the contact roles when the client is unclassified', async () => {
    queueLink(null, ['listing_agent']);
    await updateClient(rep, 5, { contactId: 42 });
    expect(setCalls.at(-1)).toMatchObject({ contactId: 42, type: 'agent' });
  });

  it('does NOT overwrite a type the rep already chose', async () => {
    queueLink('lender', ['listing_agent']);
    await updateClient(rep, 5, { contactId: 42 });
    const written = setCalls.at(-1)!;
    expect(written).toMatchObject({ contactId: 42 });
    expect(written).not.toHaveProperty('type'); // left exactly as it was
  });

  it('lets an explicit pick in the same request win over derivation', async () => {
    queueLink(null, ['listing_agent']);
    await updateClient(rep, 5, { contactId: 42, type: 'title' });
    expect(setCalls.at(-1)).toMatchObject({ contactId: 42, type: 'title' });
  });

  it('leaves type empty when the contact has no classifying role', async () => {
    queueLink(null, ['client']);
    await updateClient(rep, 5, { contactId: 42 });
    expect(setCalls.at(-1)).not.toHaveProperty('type');
  });

  it('does not derive when unlinking', async () => {
    query.rows.push([{ id: 5, ownerProfileId: 'rep-a', name: 'Jane', type: null }]);
    query.rows.push([{ id: 5, ownerProfileId: 'rep-a', name: 'Jane' }]);
    await updateClient(rep, 5, { contactId: null });
    expect(setCalls.at(-1)).toMatchObject({ contactId: null });
    expect(setCalls.at(-1)).not.toHaveProperty('type');
  });
});

describe('addClientsFromTransactions', () => {
  const session = { id: 'me', role: 'sales_rep', contactId: 7 } as never;

  it('classifies seeded clients from their party roles', async () => {
    // Queue order matches execution: fetchOwnExclusions runs first (it is
    // invoked while the Promise.all array is built), then direct, then parties.
    query.rows.push([]);                                                    // existing crm clients (no exclusions)
    query.rows.push([]);                                                    // orders.clientContactId rows
    query.rows.push([{ orderId: 1, contactId: 42, openedAt: new Date('2026-05-01'), role: 'listing_agent' }]);
    query.rows.push([{ id: 42, fullName: 'Jane Smith', companyName: 'KW', email: 'j@kw.com', phone: null }]);
    query.rows.push([{ id: 1, ownerProfileId: 'rep-a', name: 'Jane Smith' }]); // insert ... returning

    const result = await addClientsFromTransactions(session, [42]);

    expect(result.added).toBe(1);
    const inserted = (insertCalls.at(-1) as Array<Record<string, unknown>>)[0];
    expect(inserted).toMatchObject({ contactId: 42, type: 'agent' });
  });

  it('refuses contacts that are not on the caller’s own orders', async () => {
    // orders / order_parties / existing-crm reads all come back empty, so
    // nothing is eligible and no insert may happen.
    query.rows.push([], [], []);
    const result = await addClientsFromTransactions(session, [10, 11]);
    expect(result).toEqual({ added: 0, skipped: 2, clients: [] });
    expect(insertCalls).toHaveLength(0);
  });
});
