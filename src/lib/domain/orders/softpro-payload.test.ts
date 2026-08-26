import { describe, expect, it } from 'vitest';
import type { CreateOrderInput } from './create-order';
import {
  assertKnownTitleOffice,
  buildSoftProPayload,
  resolveEscrowOfficerLookup,
  resolveTitleExaminerLookup,
  resolveTitleOfficeFields,
  SoftProPayloadError,
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

  it('takes the title pair from the title officer even when an escrow officer is present', () => {
    // Order 1077788 (Visalia, Title & Escrow, rejected). The office came from
    // escrow officer Anna Ballesteros (PRV) while the examiner came from title
    // officer Clive Virata, so the pair described two different people.
    const payload = buildSoftProPayload(
      { ...baseInput, orderType: 'Title & Escrow' },
      { apn: '1', legal: 'Lot', county: 'Tulare' },
      {
        titleOfficer: officer({
          id: 5,
          officerName: 'Clive Virata',
          fullName: 'Clive Virata',
          officeLookupCode: 'OCT',
          lookupCode: 'OCT',
          softproLookupCode: 'PCT\\cvirata',
          closerExaminer: 'PCT\\cvirata',
        }),
        escrowOfficer: officer({
          id: 12,
          officerName: 'Anna Ballesteros',
          fullName: 'Anna Ballesteros',
          officeLookupCode: 'PRV',
          lookupCode: 'AnnBalPaci',
          softproLookupCode: 'PCT\\aballesteros',
          closerExaminer: 'PCT\\aballesteros',
        }),
      },
    );
    const tx = payload.transactionDetails as Record<string, unknown>;

    expect(tx.LookUpCodeTitleOffice).toBe('OCT');
    expect(tx.TitleOffice).toBe('PCT\\cvirata');
    expect(tx.LookUpCodeTitleOffice).not.toBe('PRV');
  });

  it('gives Title only and Title & Escrow the same title pair for the same title officer', () => {
    const titleOfficer = officer({
      officeLookupCode: 'TSG',
      lookupCode: 'TSG',
      softproLookupCode: 'PCT\\kcameron',
      closerExaminer: 'PCT\\kcameron',
    });
    const escrowOfficer = officer({ officeLookupCode: 'ONT', lookupCode: 'KarCasPaci' });
    const enriched = { apn: '1', legal: 'Lot', county: 'Orange' };

    const titleOnly = buildSoftProPayload(baseInput, enriched, { titleOfficer })
      .transactionDetails as Record<string, unknown>;
    const both = buildSoftProPayload(
      { ...baseInput, orderType: 'Title & Escrow' }, enriched, { titleOfficer, escrowOfficer },
    ).transactionDetails as Record<string, unknown>;

    expect({ office: both.LookUpCodeTitleOffice, examiner: both.TitleOffice })
      .toEqual({ office: titleOnly.LookUpCodeTitleOffice, examiner: titleOnly.TitleOffice });
    expect(both.LookUpCodeTitleOffice).toBe('TSG');
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

describe('resolveTitleOfficeFields', () => {
  it('refuses a title officer with no office code, and names them', () => {
    expect(() => resolveTitleOfficeFields(officer({
      officerName: 'Rachel Barcena',
      officeLookupCode: null,
    }))).toThrow(SoftProPayloadError);

    try {
      resolveTitleOfficeFields(officer({ officerName: 'Rachel Barcena', officeLookupCode: null }));
      expect.unreachable('expected a refusal');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Rachel Barcena');
      expect(message).toContain('no office code');
      // The old OFFICER_BRANCH_MAP knew this name meant GLT. Guessing is the bug.
      expect(message).not.toContain('GLT');
    }
  });

  it('never infers an office from a name that the deleted branch map used to cover', () => {
    expect(() => resolveTitleOfficeFields(officer({
      officerName: 'Anna Ballesteros',
      fullName: 'Anna Ballesteros',
      officeLookupCode: '',
    }))).toThrow(/Anna Ballesteros/);
  });

  it('falls back to the head office only when no title officer is assigned at all', () => {
    expect(resolveTitleOfficeFields(undefined)).toEqual({ LookUpCodeTitleOffice: 'GLT' });
  });
});

describe('escrow officer fields', () => {
  const escrow = (overrides: Partial<ResolvedContact>) => officer({
    id: 12,
    officerName: 'Anna Ballesteros',
    fullName: 'Anna Ballesteros',
    lookupCode: 'AnnBalPaci',
    officeLookupCode: 'PRV',
    softproLookupCode: 'PCT\\aballesteros',
    closerExaminer: 'PCT\\aballesteros',
    ...overrides,
  });

  it('sends the SoftPro user code, not the address-book code', () => {
    // Staging accepted "AnnBalPaci" on TEST-20002217-OCT and returned the order
    // with EscrowCompanies null and no EscrowOfficer key — the assignment was
    // dropped without an error.
    expect(resolveEscrowOfficerLookup(escrow({}))).toBe('PCT\\aballesteros');
    expect(resolveEscrowOfficerLookup(escrow({}))).not.toBe('AnnBalPaci');
  });

  it('falls back to closerExaminer when softproLookupCode is missing', () => {
    expect(resolveEscrowOfficerLookup(escrow({ softproLookupCode: null }))).toBe('PCT\\aballesteros');
  });

  it('omits rather than sending a code from the wrong namespace', () => {
    expect(resolveEscrowOfficerLookup(escrow({
      softproLookupCode: 'AnnBalPaci',
      closerExaminer: null,
    }))).toBeNull();
    expect(resolveEscrowOfficerLookup(undefined)).toBeNull();
  });

  it('puts the user code on the payload and leaves EscrowOfficerName empty', () => {
    const payload = buildSoftProPayload(
      { ...baseInput, orderType: 'Title & Escrow' },
      { apn: '1', legal: 'Lot', county: 'Tulare' },
      { titleOfficer: officer({ officeLookupCode: 'OCT' }), escrowOfficer: escrow({}) },
    );
    const tx = payload.transactionDetails as Record<string, unknown>;

    expect(tx.LookUpCodeEscrowOfficer).toBe('PCT\\aballesteros');
    expect(tx.EscrowOfficerName).toBe('');
  });

  it('leaves both escrow fields null when there is no escrow officer', () => {
    // An empty name with no code makes SoftPro assign its API service account:
    // staging TEST-20002219-OCT came back as PCT\rsupport, and TEST-20002220-OCT
    // — the same order with a null name — came back with no escrow officer.
    const payload = buildSoftProPayload(
      baseInput,
      { apn: '1', legal: 'Lot', county: 'Los Angeles' },
      { titleOfficer: officer({}) },
    );
    const tx = payload.transactionDetails as Record<string, unknown>;

    expect(tx.LookUpCodeEscrowOfficer).toBeNull();
    expect(tx.EscrowOfficerName).toBeNull();
  });

  it('sends an empty name rather than ours whenever it sends a code', () => {
    const payload = buildSoftProPayload(
      { ...baseInput, orderType: 'Escrow only' },
      { apn: '1', legal: 'Lot', county: 'Los Angeles' },
      { titleOfficer: officer({}), escrowOfficer: escrow({}) },
    );
    const tx = payload.transactionDetails as Record<string, unknown>;

    expect(tx.EscrowOfficerName).toBe('');
    expect(tx.EscrowOfficerName).not.toBe('Anna Ballesteros');
  });
});

describe('assertKnownTitleOffice', () => {
  const KNOWN = ['GLT', 'OCT', 'TSG'];
  const withOffice = (code: unknown) => ({ transactionDetails: { LookUpCodeTitleOffice: code } });

  it('names the invalid office and the accepted ones', () => {
    try {
      assertKnownTitleOffice(withOffice('PRV'), KNOWN);
      expect.unreachable('expected a refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(SoftProPayloadError);
      expect((err as Error).message).toContain('"PRV"');
      expect((err as Error).message).toContain('GLT, OCT, TSG');
    }
  });

  it('refuses PCT, the March 2026 rejection value', () => {
    expect(() => assertKnownTitleOffice(withOffice('PCT'), KNOWN)).toThrow(/"PCT"/);
  });

  it('accepts a known office regardless of case or padding', () => {
    expect(() => assertKnownTitleOffice(withOffice('OCT'), KNOWN)).not.toThrow();
    expect(() => assertKnownTitleOffice(withOffice(' oct '), KNOWN)).not.toThrow();
  });

  it('refuses an order with no office at all', () => {
    expect(() => assertKnownTitleOffice(withOffice(''), KNOWN)).toThrow(/no title office/);
    expect(() => assertKnownTitleOffice({ transactionDetails: {} }, KNOWN)).toThrow(/no title office/);
  });

  it('waves everything through when the known set is unavailable', () => {
    // A lookup that cannot answer must not become an order-entry outage.
    expect(() => assertKnownTitleOffice(withOffice('PRV'), [])).not.toThrow();
    expect(() => assertKnownTitleOffice(withOffice(''), [])).not.toThrow();
  });
});
