import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as createContactModule from './create-contact';

const {
  createUserMock,
  addCompanyMock,
  insertValues,
  companyRows,
} = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  addCompanyMock: vi.fn(),
  insertValues: [] as Array<{ table: string; vals: Record<string, unknown> }>,
  companyRows: [] as Array<{ id: number; lookupCode: string; name: string }>,
}));

vi.mock('@/lib/integrations/softpro', () => ({
  createUser: createUserMock,
  addCompany: addCompanyMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => companyRows.slice()),
        })),
      })),
    })),
    insert: vi.fn((table: { _: { name?: string } } | unknown) => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        const name = (table as { name?: string }).name
          ?? ((vals.contactId != null) ? 'contact_company_links' : 'contacts');
        insertValues.push({ table: name, vals });
        return {
          returning: vi.fn(async () => [{ id: 501 }]),
        };
      }),
    })),
  },
}));

vi.mock('./lookup-code-store', () => ({
  allocateLookupCode: vi.fn(async (base: string) => base),
  sendWithUniqueLookupCode: vi.fn(async (
    base: string,
    send: (code: string) => Promise<{ success: boolean; error?: { message?: string } }>,
  ) => {
    const result = await send(base);
    return result.success
      ? { ok: true, lookupCode: base }
      : { ok: false, error: result.error?.message ?? 'rejected', codesTried: [base], collision: false };
  }),
}));

import { createContactInSoftPro } from './create-contact';

describe('createContactInSoftPro — review locks', () => {
  beforeEach(() => {
    createUserMock.mockReset();
    addCompanyMock.mockReset();
    insertValues.length = 0;
    companyRows.length = 0;
  });

  it('rejects a missing companyLookupCode before SoftPro — typed name is not enough', async () => {
    const result = await createContactInSoftPro({
      firstName: 'John',
      lastName: 'Smith',
      companyLookupCode: '   ',
      userType: 'lender',
    });
    expect(result).toEqual({
      ok: false,
      code: 'COMPANY_REQUIRED',
      error: 'A selected company with a lookup code is required',
    });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(addCompanyMock).not.toHaveBeenCalled();
  });

  it('this module does not export or call addCompany', () => {
    expect(createContactModule).not.toHaveProperty('addCompany');
    expect(Object.keys(createContactModule)).not.toContain('createCompanyInSoftPro');
  });

  it('CreateUser failure keeps the selected company and writes no contact', async () => {
    companyRows.push({ id: 12, lookupCode: 'Well123M', name: 'Wells Fargo Bank' });
    createUserMock.mockResolvedValue({ success: false, error: { message: 'duplicate person code' } });

    const result = await createContactInSoftPro({
      firstName: 'John',
      lastName: 'Smith',
      companyLookupCode: 'Well123M',
      userType: 'lender',
    });

    expect(result).toEqual({
      ok: false,
      code: 'SOFTPRO',
      error: 'duplicate person code',
      companyKept: { id: 12, lookupCode: 'Well123M', name: 'Wells Fargo Bank' },
    });
    expect(insertValues).toHaveLength(0);
    expect(addCompanyMock).not.toHaveBeenCalled();
    expect(createUserMock.mock.calls[0]![0]).toMatchObject({
      ClientLookupCode: 'JohSmiWell',
      CompanyLookupCode: 'Well123M',
    });
  });

  it('success writes lookup_code, softpro_lookup_code, both flookup columns, and the link', async () => {
    companyRows.push({ id: 12, lookupCode: 'Well123M', name: 'Wells Fargo Bank' });
    createUserMock.mockResolvedValue({ success: true });

    const result = await createContactInSoftPro({
      firstName: 'Al',
      lastName: 'Li',
      companyLookupCode: 'Well123M',
      email: 'al@example.com',
      userType: 'lender',
    });

    expect(result.ok).toBe(true);
    const contactInsert = insertValues.find((r) => r.vals.softproLookupCode);
    expect(contactInsert?.vals).toMatchObject({
      lookupCode: 'AlLiWell',
      softproLookupCode: 'AlLiWell',
      flookupCode: 'Well123M',
      softproFlookupCode: 'Well123M',
      isLender: true,
      isRealEstateAgent: false,
    });
    expect(insertValues.some((r) => r.vals.contactId === 501 && r.vals.companyId === 12)).toBe(true);
    expect(addCompanyMock).not.toHaveBeenCalled();
  });
});
