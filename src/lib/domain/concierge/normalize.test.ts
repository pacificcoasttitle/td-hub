import { describe, expect, it } from 'vitest';
import { normalizeSubject, normalizeTransfers, toIsoDate } from './normalize';

/** Field shapes taken verbatim from the live production payload. */
const LIVE = {
  PropertyProfile: {
    SiteAddress: '10523 STONYBROOK AVE',
    SiteAddressCityState: '10523 STONYBROOK AVE, SOUTH GATE, CA 90280',
    SiteCity: 'SOUTH GATE', SiteState: 'CA', SiteZip: '90280',
    APN: '6233-014-010', CountyName: 'LOS ANGELES',
    PropertyCharacteristics: { Bedrooms: 3, Baths: 1, BuildingArea: 1487, YearBuilt: 1948, UseCodeDescription: 'Single Family Residential' },
    SaleLoanInfo: {},
  },
};

describe('subject address', () => {
  it('does not repeat the street line in the locality line', () => {
    const s = normalizeSubject(LIVE);
    expect(s.siteAddress).toBe('10523 STONYBROOK AVE');
    expect(s.siteCityState).toBe('SOUTH GATE, CA 90280');
    // The bug: SiteAddressCityState contains the street, so using it verbatim
    // printed "10523 STONYBROOK AVE" twice on the cover.
    expect(s.siteCityState).not.toContain('STONYBROOK');
  });

  it('falls back to the combined field when the parts are missing', () => {
    const s = normalizeSubject({ PropertyProfile: { SiteAddressCityState: 'ANYTOWN, CA 90001', SaleLoanInfo: {} } });
    expect(s.siteCityState).toBe('ANYTOWN, CA 90001');
  });
});

describe('subject last sale', () => {
  it('is null when SaleLoanInfo is empty — a real production case', () => {
    const s = normalizeSubject(LIVE);
    expect(s.lastSaleDate).toBeNull();
    expect(s.lastSalePrice).toBeNull();
  });
});

describe('date parsing', () => {
  it('handles the YYYYMMDD form SiteX uses for comps', () => {
    expect(toIsoDate('20260811')).toBe('2026-08-11');
  });

  it('handles the long form SiteX uses elsewhere', () => {
    expect(toIsoDate('6/1/2026 6:01:44 AM')).toBe('2026-06-01');
  });

  it('returns null for junk rather than a wrong date', () => {
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });
});

// ─── The two transfer flags, against the shapes SiteX actually sends ─────────
//
// Both of these were written against an assumed 'Y'/'N' encoding. Neither
// field uses it. The values below are copied from the stored raw payload for
// 6233-014-010 (10523 Stonybrook Ave), so these are the real shapes.

describe('CurrentOwnerFlag is the string "True", not a boolean and not "Y"', () => {
  it('reads "True" as true — the old parse returned null and blanked the column', () => {
    const [t] = normalizeTransfers({ TransferHistory: [{ CurrentOwnerFlag: 'True' }] });
    expect(t.currentOwnerFlag).toBe(true);
  });

  it('still reads the encodings it already handled', () => {
    const rows = normalizeTransfers({
      TransferHistory: [
        { CurrentOwnerFlag: true }, { CurrentOwnerFlag: false },
        { CurrentOwnerFlag: 'Y' }, { CurrentOwnerFlag: 'N' },
        { CurrentOwnerFlag: 'False' }, { CurrentOwnerFlag: 'no' },
      ],
    });
    expect(rows.map((r) => r.currentOwnerFlag)).toEqual([true, false, true, false, false, false]);
  });

  it('does not invent a value for something it does not recognise', () => {
    const rows = normalizeTransfers({
      TransferHistory: [{ CurrentOwnerFlag: 'maybe' }, { CurrentOwnerFlag: 1 }, {}],
    });
    expect(rows.map((r) => r.currentOwnerFlag)).toEqual([null, null, null]);
  });
});

describe('Foreclosure is an object or null — never a flag', () => {
  // The real discriminator, and the reason this is not a guess: the object
  // appears on exactly the transfers whose TransactionType is 'Foreclosure'.
  const REAL_SHAPE = [
    { TransactionType: 'Assignment', Foreclosure: null },
    { TransactionType: 'Foreclosure', Foreclosure: { ForeclosureTypeCodeDesc: 'Foreclosure Cancellation', AuctionDate: null } },
    { TransactionType: 'Foreclosure', Foreclosure: { ForeclosureTypeCodeDesc: 'Foreclosure 1st Legal Action', CaseNumber: 'CA07000465-22-1' } },
    { TransactionType: 'Release', Foreclosure: null },
    { TransactionType: 'Mortgage', Foreclosure: null },
    { TransactionType: 'Transfer', Foreclosure: null },
  ];

  it('flags exactly the foreclosure rows, and no others', () => {
    const rows = normalizeTransfers({ TransferHistory: REAL_SHAPE });
    const flagged = rows.filter((r) => r.isForeclosure === true);
    // Separates 2 from 4 — a test that could fail, unlike a null-vs-null check.
    expect(flagged).toHaveLength(2);
    expect(rows.map((r) => r.isForeclosure)).toEqual([false, true, true, false, false, false]);
  });

  it('agrees with the independent TransactionType field on every row', () => {
    const rows = normalizeTransfers({ TransferHistory: REAL_SHAPE });
    for (const [i, r] of rows.entries()) {
      expect(r.isForeclosure, `row ${i}`).toBe(REAL_SHAPE[i].TransactionType === 'Foreclosure');
    }
  });

  it('an ABSENT key is unknown, which is not the same as no foreclosure', () => {
    const [t] = normalizeTransfers({ TransferHistory: [{ TransactionType: 'Deed' }] });
    expect(t.isForeclosure).toBeNull();
  });

  it('a cancellation still flags true — the document prints the type, not this', () => {
    const [t] = normalizeTransfers({
      TransferHistory: [{ Foreclosure: { ForeclosureTypeCodeDesc: 'Foreclosure Cancellation' } }],
    });
    expect(t.isForeclosure).toBe(true);
    expect(t.documentType).toBeNull();
  });
});

// ─── What a transfer was for, and between whom ──────────────────────────────
//
// Legacy carried the amount and the parties; v6 dropped them and a rep asked
// for them back. NONE OF THESE ARE TOP-LEVEL FIELDS, which is the whole reason
// this describe exists — reading keys SiteX never sends is how normalizeSubject
// went wrong once already. The shapes below are taken from the 44 stored
// transfers on profiles 12 and 13, with the fill rates measured there.

describe('transfer amount and parties, from the fields SiteX actually sends', () => {
  const one = (t: Record<string, unknown>) => normalizeTransfers({ TransferHistory: [t] } as never)[0]!;

  it('reads a deed as a sale, with buyer and seller', () => {
    const r = one({
      DocumentType: 'Deed',
      Deed: {
        SalesPrice: '595000',
        BuyerInfo: { BuyerNames: 'VADILLO, ANGEL DAVID LOPEZ; AGUILAR, ERIKA SALAS' },
        SellerInfo: { SellerNames: 'D R HORTON LOS ANGELES HOLDING CO INC' },
      },
    });
    expect(r.amount).toBe(595_000);
    expect(r.amountKind).toBe('sale');
    expect(r.partyTo).toContain('VADILLO');
    expect(r.partyFrom).toContain('D R HORTON');
  });

  it('reads a mortgage as a loan, with borrower and lender', () => {
    const r = one({
      DocumentType: 'Mortgage',
      Mortgage: {
        LoanAmount: '583942',
        LenderName: 'DHI MORTGAGE COMPANY LTD',
        BorrowerInfo: { BorrowerNames: 'VADILLO, ANGEL DAVID LOPEZ' },
      },
    });
    expect(r.amount).toBe(583_942);
    expect(r.amountKind).toBe('loan');
    expect(r.partyTo).toContain('VADILLO');
    expect(r.partyFrom).toBe('DHI MORTGAGE COMPANY LTD');
  });

  it('prefers the deed when a record carries both blocks', () => {
    // A purchase with financing has both. The sale price is the figure a reader
    // is looking for; the loan appears on its own row, because SiteX records
    // the mortgage as a separate transfer.
    const r = one({
      Deed: { SalesPrice: '595000', BuyerInfo: { BuyerNames: 'BUYER' }, SellerInfo: { SellerNames: 'SELLER' } },
      Mortgage: { LoanAmount: '583942', LenderName: 'LENDER' },
    });
    expect(r.amountKind).toBe('sale');
    expect(r.amount).toBe(595_000);
  });

  it('takes a release from its original loan and names the borrower', () => {
    const r = one({
      DocumentType: 'Release',
      Release: {
        BuyerorBorrower1LastOrCorporateName: 'ELIZABETH A HANSON A WIDOW',
        CurrentBeneficiaryLender: 'KEVIN BUSH',
        OriginalLoan: { LoanAmount: '319800' },
      },
    });
    expect(r.amount).toBe(319_800);
    expect(r.partyTo).toContain('HANSON');
    expect(r.partyFrom).toBe('KEVIN BUSH');
  });

  it('leaves everything null when the record carries none of it', () => {
    // Measured: Deed.SalesPrice is filled on 7 of 11 deeds and
    // Foreclosure.LoanAmount on 0 of 4. An absent amount is the normal case,
    // not a parse failure, and must read as absent rather than as zero.
    const r = one({ DocumentType: 'Pre-Foreclosure', Foreclosure: { LoanAmount: '' } });
    expect(r.amount).toBeNull();
    expect(r.amountKind).toBeNull();
    expect(r.partyTo).toBeNull();
    expect(r.partyFrom).toBeNull();
  });

  it('treats an empty or zero amount as absent, with the parties still read', () => {
    const r = one({ Deed: { SalesPrice: '0', BuyerInfo: { BuyerNames: 'BUYER' }, SellerInfo: { SellerNames: 'SELLER' } } });
    expect(r.amount).toBeNull();
    expect(r.amountKind).toBeNull();
    expect(r.partyTo).toBe('BUYER');
  });

  it('does not read the mailing addresses sitting beside the names', () => {
    // BuyerInfo also carries MailFullStreetAddress, MailCityName and the rest.
    // The ask was names and amounts; a prior owner's postal address is neither.
    const r = one({
      Deed: {
        SalesPrice: '100',
        BuyerInfo: { BuyerNames: 'BUYER', MailFullStreetAddress: '9270 AMETHYST AVE', MailCityName: 'MENTONE', MailZipCode: '92359' },
        SellerInfo: { SellerNames: 'SELLER' },
      },
    });
    const serialised = JSON.stringify({ ...r, raw: undefined });
    expect(serialised).not.toContain('AMETHYST');
    expect(serialised).not.toContain('92359');
  });
});
