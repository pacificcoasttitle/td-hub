import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as createContactModule from './create-contact';

const {
  createUserMock,
  addCompanyMock,
  findSamePersonMock,
  insertValues,
  updateSets,
  companyRows,
} = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  addCompanyMock: vi.fn(),
  findSamePersonMock: vi.fn(),
  insertValues: [] as Array<{ table: string; vals: Record<string, unknown> }>,
  updateSets: [] as Array<Record<string, unknown>>,
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
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        updateSets.push(vals);
        return { where: vi.fn(async () => []) };
      }),
    })),
  },
}));

vi.mock('./lookup-code-store', () => ({
  allocateLookupCode: vi.fn(async (base: string) => base),
  findSamePersonInCodeFamily: findSamePersonMock,
  sendWithUniqueLookupCode: vi.fn(async (
    base: string,
    send: (code: string) => Promise<{ success: boolean; error?: { message?: string } }>,
    options?: { onVendorCollision?: 'suffix' | 'refuse' },
  ) => {
    const result = await send(base);
    if (result.success) return { ok: true, lookupCode: base };
    const message = result.error?.message ?? 'rejected';
    if (options?.onVendorCollision === 'refuse' && /duplicate key/i.test(message)) {
      return { ok: false, error: `SoftPro already has ${base}`, codesTried: [base], collision: true, existsInSoftPro: base };
    }
    return { ok: false, error: message, codesTried: [base], collision: false };
  }),
}));

import { createContactInSoftPro } from './create-contact';

describe('createContactInSoftPro — review locks', () => {
  beforeEach(() => {
    createUserMock.mockReset();
    addCompanyMock.mockReset();
    findSamePersonMock.mockReset();
    findSamePersonMock.mockResolvedValue(null);
    insertValues.length = 0;
    updateSets.length = 0;
    companyRows.length = 0;
  });

  // CHRIS NEWCOMER, 2026-09-11. Held as ChrNewNewc ("Christopher"), flagged so
  // the picker could not see him, and minted again as ChrNewNewc1.
  it('returns the held record instead of creating one when the same person is already in the hub', async () => {
    companyRows.push({ id: 942, lookupCode: 'Newco1773', name: 'Newcomer Escrow, Inc.' });
    findSamePersonMock.mockResolvedValue({
      id: 15511, lookupCode: 'ChrNewNewc', firstName: 'Christopher', lastName: 'Newcomer', fullName: null,
      email: 'chris@newcomerescrow.com', phone: '(714)599-7951', address1: '17731 Irvine Boulevard',
      city: 'Tustin', flookupCode: 'Newco1773', companyName: null,
    });

    const result = await createContactInSoftPro({
      firstName: 'Chris',
      lastName: 'Newcomer',
      companyLookupCode: 'Newco1773',
      email: 'Chris@NewcomerEscrow.com',
      userType: 'escrow',
    });

    expect(result).toMatchObject({ ok: true, reused: true, contact: { id: 15511, lookupCode: 'ChrNewNewc' } });
    expect(findSamePersonMock).toHaveBeenCalledWith('ChrNewNewc', 'Chris@NewcomerEscrow.com');
    expect(createUserMock).not.toHaveBeenCalled();
    expect(insertValues).toHaveLength(0);
    // The flag the operator asked for is added, so the picker finds him next time.
    expect(updateSets).toEqual([{ isEscrow: true }]);
  });

  // ERIKA VALENCIA, 2026-09-10. SoftPro held EriValEscr; the hub did not.
  it('refuses, and writes nothing, when SoftPro already has the code for someone the hub does not hold', async () => {
    companyRows.push({ id: 6250, lookupCode: 'Escr805W', name: 'Escrow360 Inc.' });
    createUserMock.mockResolvedValue({
      success: false,
      error: { message: "Cannot insert duplicate key row in object 'dbo.lkup_X'. The duplicate key value is (EriValEscr)." },
    });

    const result = await createContactInSoftPro({
      firstName: 'Erika',
      lastName: 'Valencia',
      companyLookupCode: 'Escr805W',
      email: 'Erika@escrow360inc.com',
      userType: 'escrow',
    });

    expect(result).toMatchObject({ ok: false, code: 'SOFTPRO_EXISTS', existingLookupCode: 'EriValEscr' });
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveLength(0);
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
