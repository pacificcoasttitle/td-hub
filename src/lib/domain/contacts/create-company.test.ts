import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addCompanyMock, insertValues, selectQueue } = vi.hoisted(() => ({
  addCompanyMock: vi.fn(),
  insertValues: [] as Record<string, unknown>[],
  selectQueue: [] as unknown[][],
}));

vi.mock('@/lib/integrations/softpro', () => ({
  addCompany: addCompanyMock,
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectQueue.shift() ?? []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        insertValues.push(vals);
        return {
          returning: vi.fn(async () => [{
            id: 88,
            lookupCode: vals.lookupCode,
            name: vals.name,
            address1: vals.address1,
            city: vals.city ?? null,
            phone: vals.phone ?? null,
            email: vals.email ?? null,
          }]),
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

import { createCompanyInSoftPro } from './create-company';

describe('createCompanyInSoftPro', () => {
  beforeEach(() => {
    addCompanyMock.mockReset();
    insertValues.length = 0;
    selectQueue.length = 0;
  });

  it('rejects a missing Address1 before SoftPro', async () => {
    const result = await createCompanyInSoftPro({
      name: 'Wells Fargo Bank',
      address1: '   ',
      userType: 'lender',
    });
    expect(result).toEqual({ ok: false, code: 'VALIDATION', error: 'Address1 is required' });
    expect(addCompanyMock).not.toHaveBeenCalled();
  });

  it('sends Selling Agent/Broker for realtor, not Real Estate', async () => {
    selectQueue.push([]);
    addCompanyMock.mockResolvedValue({ success: true });
    const result = await createCompanyInSoftPro({
      name: 'Harbor Realty',
      address1: '10 Pier Ave',
      userType: 'realtor',
    });
    expect(result.ok).toBe(true);
    expect(addCompanyMock.mock.calls[0]![0]).toMatchObject({
      LookupCode: 'Harb10Pi',
      UserType: 'Selling Agent/Broker',
      Address1: '10 Pier Ave',
    });
    expect(insertValues[0]).toMatchObject({
      isRealEstateCompany: true,
      isLender: false,
      lookupCode: 'Harb10Pi',
    });
  });

  it('writes no local row when AddCompany fails', async () => {
    selectQueue.push([]);
    addCompanyMock.mockResolvedValue({ success: false, error: { message: 'rejected' } });
    const result = await createCompanyInSoftPro({
      name: 'Harbor Realty',
      address1: '10 Pier Ave',
      userType: 'realtor',
    });
    expect(result).toMatchObject({ ok: false, code: 'SOFTPRO' });
    expect(insertValues).toHaveLength(0);
  });

  it('refuses an exact name+address duplicate without calling SoftPro', async () => {
    selectQueue.push([{
      id: 1,
      name: 'Wells Fargo Bank',
      lookupCode: 'Well123M',
      address1: '123 Main Street',
      city: 'Irvine',
      state: 'CA',
      zip: '92614',
      phone: null,
      email: null,
    }]);
    const result = await createCompanyInSoftPro({
      name: 'Wells Fargo Bank',
      address1: '123 Main Street',
      city: 'Irvine',
      userType: 'lender',
      confirmCreate: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EXACT_DUPLICATE');
    expect(addCompanyMock).not.toHaveBeenCalled();
  });

  it('surfaces near matches unless confirmCreate is set', async () => {
    selectQueue.push([{
      id: 2,
      name: 'Wells Fargo Bank',
      lookupCode: 'Well420M',
      address1: '420 Montgomery',
      city: 'SF',
      state: 'CA',
      zip: null,
      phone: null,
      email: null,
    }]);
    const result = await createCompanyInSoftPro({
      name: 'Wells Fargo',
      address1: '1 Market St',
      userType: 'lender',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NEAR_MATCH');
    expect(addCompanyMock).not.toHaveBeenCalled();
  });
});
