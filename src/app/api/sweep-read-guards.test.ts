import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The last four reads closed by the 2026-09-14 sweep. Each is called as a client
// (refused, nothing read) and as a role that legitimately uses it (let through).

const { getSessionMock, canAccessOrderMock, loadConfirmationDataMock, dbTouched, orderRows } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  canAccessOrderMock: vi.fn(),
  loadConfirmationDataMock: vi.fn(),
  dbTouched: vi.fn(),
  orderRows: { value: [] as unknown[] },
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/security/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/security/permissions')>()),
  canAccessOrder: canAccessOrderMock,
}));
vi.mock('@/lib/domain/orders/confirm-data', () => ({ loadConfirmationData: loadConfirmationDataMock }));
vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'leftJoin', 'innerJoin', 'groupBy', 'offset']) chain[m] = () => chain;
  chain.limit = async () => { dbTouched(); return orderRows.value; };
  chain.then = (ok: (v: unknown) => unknown) => { dbTouched(); return Promise.resolve([]).then(ok); };
  return { db: { select: () => chain, execute: async () => { dbTouched(); return []; } } };
});

import { GET as confirmGet } from './orders/confirm/[fileNumber]/route';
import { GET as dashboardGet } from './dashboard/route';
import { GET as formOptionsGet } from './form-options/route';
import { GET as staffListGet } from './staff/list/route';

const CLIENT = { id: 'c1', role: 'client', contactId: 9, email: 'c@example.com', displayName: null, branchId: null };
const OOT = { id: 'o1', role: 'open_order_team', contactId: null, email: 'o@pct.com', displayName: null, branchId: null };
const ADMIN = { id: 'a1', role: 'admin', contactId: null, email: 'a@pct.com', displayName: null, branchId: null };
const confirm = () => confirmGet(new NextRequest('http://localhost/api/orders/confirm/20022166-GLT'),
  { params: Promise.resolve({ fileNumber: '20022166-GLT' }) });

beforeEach(() => {
  getSessionMock.mockReset();
  canAccessOrderMock.mockReset();
  loadConfirmationDataMock.mockReset().mockResolvedValue({ order: { fileNumber: '20022166-GLT' } });
  dbTouched.mockReset();
  orderRows.value = [];
});

describe('GET /api/orders/confirm/[fileNumber]', () => {
  it('returns not found, and loads nothing, for a file the session cannot open', async () => {
    getSessionMock.mockResolvedValue(CLIENT);
    orderRows.value = [{ id: 8687 }];
    canAccessOrderMock.mockResolvedValue(false);

    const res = await confirm();

    expect(res.status).toBe(404);
    expect(canAccessOrderMock).toHaveBeenCalledWith(CLIENT, 8687);
    expect(loadConfirmationDataMock).not.toHaveBeenCalled();
  });

  it('returns not found for a file number that does not exist', async () => {
    getSessionMock.mockResolvedValue(OOT);
    expect((await confirm()).status).toBe(404);
    expect(loadConfirmationDataMock).not.toHaveBeenCalled();
  });

  it('serves a file the session can open', async () => {
    getSessionMock.mockResolvedValue(OOT);
    orderRows.value = [{ id: 8687 }];
    canAccessOrderMock.mockResolvedValue(true);

    const res = await confirm();

    expect(res.status).toBe(200);
    expect(loadConfirmationDataMock).toHaveBeenCalledWith('20022166-GLT');
  });
});

describe('GET /api/dashboard', () => {
  it('refuses a non-staff session before reading anything', async () => {
    for (const session of [CLIENT, OOT]) {
      getSessionMock.mockResolvedValue(session);
      expect((await dashboardGet()).status).toBe(403);
    }
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it('serves staff', async () => {
    getSessionMock.mockResolvedValue(ADMIN);
    expect((await dashboardGet()).status).toBe(200);
  });
});

describe.each([
  ['GET /api/form-options', () => formOptionsGet()],
  ['GET /api/staff/list', () => staffListGet()],
])('%s — the staff directory', (_name, call) => {
  it('refuses a client before reading anything', async () => {
    getSessionMock.mockResolvedValue(CLIENT);
    expect((await call()).status).toBe(403);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it('serves the open order team', async () => {
    getSessionMock.mockResolvedValue(OOT);
    const res = await call();
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
