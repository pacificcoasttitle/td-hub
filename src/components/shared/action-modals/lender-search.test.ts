import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchLenders } from './lender-search';

const PRIV = { id: 6395, name: 'Private Money Solutions, Inc', lookupCode: 'Priv1503', address1: '15030 Ventura Blvd., #500', city: 'Sherman Oaks', state: 'CA', zip: '91403', assignmentClause: null };
const PML = { id: 3437, name: 'Private Money Lenders, Inc.', lookupCode: 'Priva1771', address1: '17715 Chatsworth Street, Ste 101', city: 'Granada Hills', state: 'CA', zip: '91344', assignmentClause: 'ISAOA/ATIMA' };
const RIC = { id: 6124, companyName: 'Private Money Lenders, Inc.', companyLookupCode: 'Priva1771', address: '17715 Chatsworth Street, Ste 101', city: 'Granada Hills', state: 'CA', zip: '91344' };
const PACIFIC = { id: 21301, companyName: 'Pacific Private Money, Inc. dba Arrival Home Loans', companyLookupCode: null, address: '1555 Grant Avenue', city: 'Novato', state: 'CA', zip: '94945' };

function mockFetch(companies: unknown[], contacts: unknown[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const body = url.startsWith('/api/companies') ? { companies } : { results: contacts };
    return { ok: true, json: async () => body } as Response;
  }));
  return calls;
}

describe('searchLenders', () => {
  afterEach(() => vi.unstubAllGlobals());

  // REGRESSION 2026-09-12. "private money" returned Private Money Lenders and
  // Pacific Private Money — both via contacts — and never Priv1503, which has
  // no contact attached.
  it('finds a lender company that has nobody attached to it', async () => {
    mockFetch([PRIV, PML], [RIC, PACIFIC]);
    const results = await searchLenders('private money', { includeCompanies: true });
    const priv = results.find((r) => r.lookupCode === 'Priv1503');
    expect(priv).toMatchObject({ kind: 'company', companyId: 6395, address: '15030 Ventura Blvd., #500', zip: '91403' });
  });

  it('does not show a company twice when a contact of it also matches', async () => {
    mockFetch([PRIV, PML], [RIC, PACIFIC]);
    const results = await searchLenders('private money', { includeCompanies: true });
    expect(results.filter((r) => r.companyName === 'Private Money Lenders, Inc.')).toHaveLength(1);
    expect(results.map((r) => r.key)).toEqual(['company-6395', 'company-3437', 'contact-21301']);
  });

  // A contact id is not a company id. The Proposed Insured modal used to store
  // one in lenderCompanyId.
  it('never gives a contact row a company id', async () => {
    mockFetch([], [RIC]);
    const [only] = await searchLenders('ric', { includeCompanies: true });
    expect(only).toMatchObject({ kind: 'contact', companyId: null, lookupCode: 'Priva1771' });
  });

  // Clients: /api/companies answers any session, and the client view has never
  // listed companies. Unchanged.
  it('does not query companies for a client', async () => {
    const calls = mockFetch([PRIV], []);
    await searchLenders('private money', { includeCompanies: false });
    expect(calls.some((u) => u.startsWith('/api/companies'))).toBe(false);
  });
});
