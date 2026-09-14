import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Every read of the master contact and company book, called as a client and as
// the open order team. Behavioural rather than a scan of the source: the thing
// being asserted is what a client session gets back.

const { getSessionMock, dataTouched } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  dataTouched: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));

// Anything past the guard counts as "the book was read". Each returns an empty
// but valid shape so the internal-role call can complete.
vi.mock('@/lib/domain/contacts/service', () => ({
  getContacts: vi.fn(async () => { dataTouched('getContacts'); return { contacts: [], total: 0 }; }),
  getCompanies: vi.fn(async () => { dataTouched('getCompanies'); return { companies: [], total: 0 }; }),
  getContactById: vi.fn(async () => { dataTouched('getContactById'); return { id: 1 }; }),
  getCompanyById: vi.fn(async () => { dataTouched('getCompanyById'); return { id: 1 }; }),
}));
vi.mock('@/lib/domain/contacts/create-company', () => ({
  findNearCompanies: vi.fn(async () => { dataTouched('findNearCompanies'); return []; }),
  createCompanyInSoftPro: vi.fn(),
}));
vi.mock('@/lib/db/client', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'groupBy']) {
    chain[m] = () => chain;
  }
  chain.then = (ok: (v: unknown) => unknown) => { dataTouched('db'); return Promise.resolve([]).then(ok); };
  return { db: { select: () => chain, execute: async () => { dataTouched('db'); return []; } } };
});
vi.mock('@/lib/integrations/softpro', () => ({ updateUser: vi.fn(), updateCompany: vi.fn() }));

import { GET as contactsList } from '@/app/api/contacts/route';
import { GET as contactById } from '@/app/api/contacts/[id]/route';
import { GET as contactManager } from '@/app/api/contacts/[id]/manager/route';
import { GET as contactSearch } from '@/app/api/contacts/search/route';
import { GET as companiesList } from '@/app/api/companies/route';
import { GET as companyById } from '@/app/api/companies/[id]/route';
import { GET as companyNearMatch } from '@/app/api/companies/near-match/route';
import { CONTACT_BOOK_READ_ROLES, canReadContactBook } from './contact-book-access';

const req = (url: string) => new NextRequest(`http://localhost${url}`);
const idParams = { params: Promise.resolve({ id: '17356' }) };

// [name, call, status a refused client gets]. /api/contacts/search has always
// answered a wrong role with 401; its behaviour is unchanged here.
const READS: Array<[string, () => Promise<Response>, number]> = [
  ['GET /api/contacts', () => contactsList(req('/api/contacts?search=sm&pageSize=6')), 403],
  ['GET /api/contacts/[id]', () => contactById(req('/api/contacts/17356'), idParams), 403],
  ['GET /api/contacts/[id]/manager', () => contactManager(req('/api/contacts/17356/manager'), idParams), 403],
  ['GET /api/contacts/search', () => contactSearch(req('/api/contacts/search?q=sm')), 401],
  ['GET /api/companies', () => companiesList(req('/api/companies?search=pr&pageSize=6')), 403],
  ['GET /api/companies/[id]', () => companyById(req('/api/companies/6395'), idParams), 403],
  ['GET /api/companies/near-match', () => companyNearMatch(req('/api/companies/near-match?name=Private')), 403],
];

describe('the master contact and company book', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    dataTouched.mockReset();
  });

  describe.each(READS)('%s', (_name, call, refusedStatus) => {
    it('refuses a client session and never reads the book', async () => {
      getSessionMock.mockResolvedValue({ id: 'c1', role: 'client', contactId: 9 });
      const res = await call();
      expect(res.status).toBe(refusedStatus);
      expect(dataTouched).not.toHaveBeenCalled();
    });

    it('refuses no session with 401', async () => {
      getSessionMock.mockResolvedValue(null);
      expect((await call()).status).toBe(401);
      expect(dataTouched).not.toHaveBeenCalled();
    });

    it('lets the open order team through', async () => {
      getSessionMock.mockResolvedValue({ id: 'o1', role: 'open_order_team', contactId: null });
      const res = await call();
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
      expect(dataTouched).toHaveBeenCalled();
    });
  });

  it('is the list /api/contacts/search already enforced, and excludes client', () => {
    expect([...CONTACT_BOOK_READ_ROLES].sort()).toEqual([
      'admin', 'cs_admin', 'escrow_assistant', 'escrow_officer', 'open_order_team',
      'sales_rep', 'super_admin', 'title_officer',
    ]);
    expect(canReadContactBook('client')).toBe(false);
  });
});
