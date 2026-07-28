import { describe, expect, it } from 'vitest';
import type { CreateOrderInput } from './create-order';
import {
  buildSoftProPayload,
  resolveTitleExaminerLookup,
  type ResolvedContact,
  type ResolvedContacts,
} from './softpro-payload';

const baseInput: CreateOrderInput = {
  orderType: 'Title only',
  isRushOrder: false,
  property: {
    address: '123 Main St',
    city: 'Glendale',
    state: 'CA',
    zip: '91203',
  },
  seller: { firstName: 'TBD', lastName: 'TBD', isOrganization: false },
  buyer: { firstName: 'Buyer', lastName: 'One', isOrganization: false },
  transaction: {
    type: 'Purchase',
    product: 'Residential',
    salesAmount: 500000,
    loanAmount: 400000,
    coverageAmount: 500000,
    branchCode: 'PCT',
    escrowNumber: 'ESC-1',
    underwriterCode: 'WC',
  },
};

function officer(overrides: Partial<ResolvedContact>): ResolvedContact {
  return {
    id: 42,
    fullName: 'Eddie LasMarias',
    firstName: 'Eddie',
    lastName: 'LasMarias',
    email: 'eddie@pct.com',
    phone: '555-0001',
    companyName: 'Pacific Coast Title',
    // Branch office code — must NEVER become TitleOffice
    lookupCode: 'GLT',
    flookupCode: null,
    officeLookupCode: 'GLT',
    softproLookupCode: 'PCT\\elasmarias',
    closerExaminer: 'PCT\\elasmarias',
    officerName: 'Eddie LasMarias',
    softproUserType: null,
    userType: null,
    address1: null,
    city: null,
    state: null,
    zip: null,
    ...overrides,
  };
}

describe('resolveTitleExaminerLookup', () => {
  it('prefers softproLookupCode (examiner) over branch lookupCode', () => {
    expect(resolveTitleExaminerLookup(officer({
      softproLookupCode: 'PCT\\elasmarias',
      closerExaminer: 'PCT\\other',
      lookupCode: 'GLT',
    }))).toBe('PCT\\elasmarias');
  });

  it('falls back to closerExaminer when softproLookupCode is missing', () => {
    expect(resolveTitleExaminerLookup(officer({
      softproLookupCode: null,
      closerExaminer: 'PCT\\elasmarias',
      lookupCode: 'GLT',
    }))).toBe('PCT\\elasmarias');
  });

  it('never falls back to branch lookupCode / officeLookupCode', () => {
    expect(resolveTitleExaminerLookup(officer({
      softproLookupCode: null,
      closerExaminer: null,
      lookupCode: 'GLT',
      officeLookupCode: 'GLT',
    }))).toBeNull();
  });

  it('omits when softproLookupCode is wrongly equal to the branch code', () => {
    expect(resolveTitleExaminerLookup(officer({
      softproLookupCode: 'GLT',
      closerExaminer: null,
      lookupCode: 'GLT',
      officeLookupCode: 'GLT',
    }))).toBeNull();
  });
});

describe('buildSoftProPayload TitleOffice examiner', () => {
  it('sends TitleOffice = PCT\\examiner and LookUpCodeTitleOffice = branch (mirrors 20015761-GLT)', () => {
    const resolved: ResolvedContacts = {
      titleOfficer: officer({
        softproLookupCode: 'PCT\\elasmarias',
        closerExaminer: 'PCT\\elasmarias',
        lookupCode: 'GLT',
        officeLookupCode: 'GLT',
      }),
    };

    const payload = buildSoftProPayload(
      baseInput,
      { apn: '5641-001-002', legal: 'Lot 1', county: 'Los Angeles' },
      resolved,
    );
    const tx = payload.transactionDetails as Record<string, unknown>;

    expect(tx.TitleOffice).toBe('PCT\\elasmarias');
    expect(tx.LookUpCodeTitleOffice).toBe('GLT');
    expect(tx.TitleOffice).not.toBe('GLT');
    expect(tx.TitleOffice).not.toBe(tx.LookUpCodeTitleOffice);

    // Sample create payload proof (same shape SoftPro receives for TitleOffice fields)
    // See scripts/softpro-titleoffice-examiner-sample.json
    expect({
      LookUpCodeTitleOffice: tx.LookUpCodeTitleOffice,
      TitleOffice: tx.TitleOffice,
    }).toEqual({
      LookUpCodeTitleOffice: 'GLT',
      TitleOffice: 'PCT\\elasmarias',
    });
  });

  it('uses closerExaminer when softproLookupCode is absent', () => {
    const payload = buildSoftProPayload(
      baseInput,
      { apn: '1', legal: 'Lot', county: 'Los Angeles' },
      {
        titleOfficer: officer({
          softproLookupCode: null,
          closerExaminer: 'PCT\\elasmarias',
          lookupCode: 'GLT',
        }),
      },
    );
    const tx = payload.transactionDetails as Record<string, unknown>;
    expect(tx.TitleOffice).toBe('PCT\\elasmarias');
    expect(tx.LookUpCodeTitleOffice).toBe('GLT');
  });

  it('omits TitleOffice when examiner lookup is missing (does not send branch)', () => {
    const payload = buildSoftProPayload(
      baseInput,
      { apn: '1', legal: 'Lot', county: 'Los Angeles' },
      {
        titleOfficer: officer({
          softproLookupCode: null,
          closerExaminer: null,
          lookupCode: 'GLT',
          officeLookupCode: 'GLT',
        }),
      },
    );
    const tx = payload.transactionDetails as Record<string, unknown>;

    expect(tx).not.toHaveProperty('TitleOffice');
    expect(tx.LookUpCodeTitleOffice).toBe('GLT');
    expect(JSON.stringify(tx)).not.toMatch(/"TitleOffice"\s*:\s*"GLT"/);
  });

  it('does not use titleOfficer.lookupCode for TitleOffice even if it is the only code present', () => {
    const payload = buildSoftProPayload(
      baseInput,
      { apn: '1', legal: 'Lot', county: 'Los Angeles' },
      {
        titleOfficer: officer({
          softproLookupCode: undefined,
          closerExaminer: undefined,
          lookupCode: 'GLT',
        }),
      },
    );
    const tx = payload.transactionDetails as Record<string, unknown>;
    expect(tx.TitleOffice).toBeUndefined();
  });
});
