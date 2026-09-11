import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, getCompanyByIdMock, updateCompanyMock, setCalls } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getCompanyByIdMock: vi.fn(),
  updateCompanyMock: vi.fn(),
  setCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/domain/contacts/service', () => ({ getCompanyById: getCompanyByIdMock }));
vi.mock('@/lib/integrations/softpro', () => ({ updateCompany: updateCompanyMock }));
vi.mock('@/lib/db/client', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        setCalls.push(vals);
        return { where: vi.fn(async () => []) };
      }),
    })),
  },
}));

import { COMPANY_TYPE_MAP } from '@/lib/domain/contacts/company-constants';
import { PUT } from './route';

const STORED = {
  id: 6395,
  name: 'Private Money Solutions, Inc',
  companyType: 'lender',
  lookupCode: 'Priv1503',
  address1: '15030 Ventura Blvd., #500',
  city: 'Sherman Oaks',
  state: 'CA',
  zip: '91403',
  phone: '818-555-0100',
  email: 'info@pms.example',
};

function put(body: unknown) {
  const req = new Request('http://localhost/api/companies/6395', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
  return PUT(req, { params: Promise.resolve({ id: '6395' }) });
}

describe('PUT /api/companies/[id] — the SoftPro payload is the stored row plus the changes', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({ id: 'u1', role: 'admin' });
    getCompanyByIdMock.mockResolvedValue({ ...STORED });
    updateCompanyMock.mockReset();
    updateCompanyMock.mockResolvedValue({ success: true });
    setCalls.length = 0;
  });

  // REGRESSION 2026-09-12. The edit form had no address field and sent
  // `Address1: ""`, which UpdateCompany wrote over Priv1503's address in SoftPro.
  it('keeps the stored address when the form does not send one', async () => {
    const res = await put({ name: STORED.name, city: STORED.city, state: STORED.state, zip: STORED.zip, companyType: 'Lender' });
    expect(res.status).toBe(200);
    expect(updateCompanyMock.mock.calls[0]![0]).toMatchObject({ Address1: '15030 Ventura Blvd., #500' });
    expect(setCalls[0]).toMatchObject({ address1: '15030 Ventura Blvd., #500' });
  });

  // The generic Companies page hard-coded `zip: ''`, and every input posts a
  // string, so blank must mean "unchanged", not "erase".
  it('treats a blank field as unchanged, not as a request to erase it', async () => {
    await put({ name: STORED.name, address: '', zip: '', phone: '', email: '', companyType: 'Lender' });
    expect(updateCompanyMock.mock.calls[0]![0]).toMatchObject({
      Address1: STORED.address1, Zip: STORED.zip, Phone: STORED.phone, Email: STORED.email,
    });
  });

  it('sends a changed field and keeps everything else stored', async () => {
    await put({ name: STORED.name, phone: '818-555-0199', companyType: 'Lender' });
    expect(updateCompanyMock.mock.calls[0]![0]).toMatchObject({
      Phone: '818-555-0199', Address1: STORED.address1, City: STORED.city, Zip: STORED.zip, LookupCode: 'Priv1503',
    });
  });

  it('falls back to the stored company type for UserType when the form leaves it blank', async () => {
    await put({ name: STORED.name, companyType: '' });
    expect(updateCompanyMock.mock.calls[0]![0]).toMatchObject({ UserType: COMPANY_TYPE_MAP.lender });
  });
});
