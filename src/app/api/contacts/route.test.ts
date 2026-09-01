import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionMock, createContactMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  createContactMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/domain/contacts/service', () => ({ getContacts: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ db: { select: vi.fn(), insert: vi.fn() } }));
vi.mock('@/lib/domain/contacts/create-contact', async () => {
  const actual = await vi.importActual<typeof import('@/lib/domain/contacts/create-contact')>(
    '@/lib/domain/contacts/create-contact',
  );
  return { ...actual, createContactInSoftPro: createContactMock };
});

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://localhost/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

describe('POST /api/contacts — review locks', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    createContactMock.mockReset();
    getSessionMock.mockResolvedValue({ id: 'u1', role: 'open_order_team' });
  });

  it('returns 400 COMPANY_REQUIRED when companyLookupCode is missing', async () => {
    createContactMock.mockResolvedValue({
      ok: false,
      code: 'COMPANY_REQUIRED',
      error: 'A selected company with a lookup code is required',
    });

    const res = await POST(req({
      firstName: 'John',
      lastName: 'Smith',
      companyName: 'Wells Fargo Bank',
      userType: 'lender',
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('COMPANY_REQUIRED');
    expect(createContactMock.mock.calls[0]![0].companyLookupCode).toBe('');
  });

  it('returns companyKept on CreateUser failure and does not invent a second firm', async () => {
    createContactMock.mockResolvedValue({
      ok: false,
      code: 'SOFTPRO',
      error: 'rejected',
      companyKept: { id: 12, lookupCode: 'Well123M', name: 'Wells Fargo Bank' },
    });

    const res = await POST(req({
      firstName: 'John',
      lastName: 'Smith',
      companyLookupCode: 'Well123M',
      userType: 'lender',
    }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.companyKept).toEqual({ id: 12, lookupCode: 'Well123M', name: 'Wells Fargo Bank' });
  });
});
