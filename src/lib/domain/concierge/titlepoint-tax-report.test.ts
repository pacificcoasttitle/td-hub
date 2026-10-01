import { describe, expect, it } from 'vitest';
import { melloRoosLines, melloRoosTotal, parseTitlePointTaxReport, parseTitlePointTaxResult } from './titlepoint-tax-report';
import { resolveTaxLayer, taxReportHasContent } from './document/derive';
import type { NormalizedTax } from './normalize';

// ─── The fixture is a real stored payload ───────────────────────────────────
//
// title_point_data #4765, as fetchResult stored it, trimmed to the blocks this
// parser reads and with the owner names and legal descriptions dropped. Every
// value below is verbatim — the thousands separators, the "2026-2027" tax year,
// the empty AssessedValuation, the M/D/YYYY dates and the un-separated
// installment amounts are all how TitlePoint actually sends them, which is the
// whole reason for not writing this fixture by hand.

const REAL = {
  ID: '0',
  ResultType: 'TitlePoint.TaxReportResult',
  TaxReport: {
    APN: '5178-024-010',
    TaxYear: '2026-2027',
    TotalTax: '13,387.35',
    LandValuation: '470,999.00',
    ImprovementsValuation: '485,573.00',
    AssessedValuation: '',
    AssessedValuation2: '',
    TaxRate: '1.409829',
    TaxRateArea: '07792',
    HomeOwnerExemption: '7,000.00',
    AdditionalHomesteadExemption: '',
    RunDate: '9/30/2026',
    IssueDate: '10/15/2026',
    Bonds: '',
    SpecialAssessments: '',
    CountSpecialAssessments: '0',
    Supplementals: '',
    Installments: {
      Item: [
        { Number: '1st', Amount: '6693.68', DueDate: '12/10/2026', Status: 'UNPAID', TaxYear: '2026', Balance: '6693.68', Penalty: '669.36', AmountPaid: '0.00' },
        { Number: '2nd', Amount: '6693.67', DueDate: '4/10/2027', Status: 'UNPAID', TaxYear: '2026', Balance: '6693.67', Penalty: '679.36', AmountPaid: '0.00' },
      ],
    },
    Liens: {
      Item: [
        { Account: '00170', Amount: '277.07', Description: 'LOS ANGELES COUNTY TRAUMA/EMERG SRVS', Rate: '0.000000', IsMelloRoos: 'false' },
        { Account: '00340', Amount: '129.36', Description: 'SAFE CLEAN WATER', Rate: '0.000000', IsMelloRoos: 'false' },
        { Account: '00420', Amount: '269.16', Description: 'MEASURE E-POMO', Rate: '0.000000', IsMelloRoos: 'false' },
        { Account: '00510', Amount: '74.11', Description: 'LOS ANGELES COUNTY  FLOOD CONTROL', Rate: '0.000000', IsMelloRoos: 'false' },
      ],
    },
    // Present on 58/58 real payloads. Nothing may read it.
    DelinquencyInformation: { HasDelinquency: 'false', Amount: '0.00' },
  },
};

describe('parsing what TitlePoint actually sends', () => {
  const r = parseTitlePointTaxReport(REAL)!;

  it('reads the fiscal year as its first year, not as a number', () => {
    // "2026-2027" — Number() of that is NaN and parseFloat() returns 2026 by
    // accident. The document renders the range from this.
    expect(r.taxYear).toBe(2026);
  });

  it('strips thousands separators from every money field', () => {
    expect(r.annualAmount).toBe(13387.35);
    expect(r.landValue).toBe(470999);
    expect(r.improvementValue).toBe(485573);
    expect(r.homeOwnerExemption).toBe(7000);
  });

  it('composes the assessed value, because the vendor field is empty', () => {
    // AssessedValuation is "" on all 58 stored payloads.
    expect(REAL.TaxReport.AssessedValuation).toBe('');
    expect(r.assessedValue).toBe(956572);
  });

  it('composes the total, and says it had nothing to check it against', () => {
    // This payload's Liens are all fixed-dollar, so there is no base levy line
    // and nothing independent to confirm the composition. That is 'composed',
    // not 'verified' — see the next describe for why the difference matters.
    expect(parseTitlePointTaxResult(REAL)!.assessed.basis).toBe('composed');
  });

  it('keeps the rate area as text', () => {
    // "07792" here, "07-095" and "007-010" on other payloads. Numeric parsing
    // would turn the first into 7792 and the others into NaN.
    expect(r.taxRateArea).toBe('07792');
  });

  it('reads both installments with ISO dates', () => {
    expect(r.installments).toHaveLength(2);
    expect(r.installments[0]).toMatchObject({ number: '1st', amount: 6693.68, dueDate: '2026-12-10' });
    expect(r.installments[1]).toMatchObject({ number: '2nd', amount: 6693.67, dueDate: '2027-04-10' });
  });

  it('takes the as-of date from RunDate', () => {
    expect(r.asOf).toBe('2026-09-30');
  });

  it('reads the direct assessments out of Liens, not SpecialAssessments', () => {
    // SpecialAssessments is empty and CountSpecialAssessments is "0" on every
    // payload; the content is in Liens. A parser that trusted the field name
    // would report no assessments on 55 of 58 properties that have them.
    expect(REAL.TaxReport.SpecialAssessments).toBe('');
    expect(r.specialAssessments).toHaveLength(4);
    expect(r.specialAssessments[0]).toMatchObject({ description: 'LOS ANGELES COUNTY TRAUMA/EMERG SRVS', amount: 277.07 });
  });

  it('is content, so it earns a page', () => {
    expect(taxReportHasContent(r)).toBe(true);
    expect(resolveTaxLayer({} as NormalizedTax, 'CA', r)).toMatchObject({ source: 'titlepoint' });
  });
});

describe('the excluded families cannot come through', () => {
  it('reads nothing from DelinquencyInformation', () => {
    // It is on 58/58 payloads, so the exclusion is load-bearing.
    const r = parseTitlePointTaxReport(REAL)!;
    const serialized = JSON.stringify(r).toLowerCase();
    for (const word of ['delinq', 'redemption', 'backtax', 'prioryear', 'penalty', 'amountpaid', 'balance']) {
      expect(serialized, word).not.toContain(word);
    }
  });

  it('has no field for them to land in even if a future key appears', () => {
    const r = parseTitlePointTaxReport(REAL)!;
    expect(Object.keys(r).sort()).toEqual([
      'annualAmount', 'asOf', 'assessedValue', 'bonds', 'homeOwnerExemption',
      'improvementValue', 'installments', 'landValue', 'specialAssessments',
      'supplementals', 'taxRate', 'taxRateArea', 'taxYear',
    ]);
  });

  it('parses Mello-Roos without promoting it to the page', () => {
    // 3 of 58 payloads carry one. Parsed so a ruling is a render change; this
    // fixture has none, which is the common case.
    expect(melloRoosLines(REAL)).toEqual([]);
    const withMello = {
      TaxReport: {
        ...REAL.TaxReport,
        Liens: { Item: [{ Account: '1', Amount: '812.44', Description: 'CFD NO 2004-1 IMPROVEMENT AREA', Rate: '0.000000', IsMelloRoos: 'true' }] },
      },
    };
    expect(melloRoosLines(withMello)).toEqual(['CFD NO 2004-1 IMPROVEMENT AREA']);
    // And it is still just a line item on the page, with no badge.
    const parsed = parseTitlePointTaxReport(withMello)!;
    expect(parsed.specialAssessments[0]!.description).toBe('CFD NO 2004-1 IMPROVEMENT AREA');
    expect(JSON.stringify(parsed).toLowerCase()).not.toContain('mello');
  });
});

// ─── The check that is not circular ─────────────────────────────────────────
//
// THE PREVIOUS VERSION OF THESE TESTS GUARDED AN IDENTITY. It asserted that
// (land + improvements − exemption) × TaxRate/100 == TotalTax, and reported
// that it held to the cent on 90% of payloads — which it does, because TaxRate
// IS TotalTax / net × 100. Measured on the real book: it matches to five
// decimal places on 1,240 of 1,282 payloads (96.7%). The check could not fail,
// so it confirmed nothing, and the result said "verified".
//
// What is independent is the county's own base levy line, which arrives in
// `Liens` at a ~1% rate on the counties that itemise. Its amount over its rate
// is the net assessed value the COUNTY used, derived from a different field
// than the one we composed. It agrees on 204 of the 207 parseable payloads.
//
// This fixture is Riverside-shaped: an itemised bill that opens with the base.

const ITEMISED = {
  TaxReport: {
    ...REAL.TaxReport,
    // 78,027 + 449,343 − 7,000 = 520,370 net.
    LandValuation: '78,027.00',
    ImprovementsValuation: '449,343.00',
    HomeOwnerExemption: '7,000.00',
    TotalTax: '9,557.80',
    TaxRate: '1.836731',
    // All eleven lines as stored, not an abridgement — the first draft kept
    // four and then could not reproduce TotalTax, which is the one property
    // this fixture exists to demonstrate.
    Liens: {
      Item: [
        // 5,203.70 / 1% = 520,370 — the same net, from the county's side.
        { Account: '01-0000', Amount: '5,203.70', Rate: '1.000000', IsMelloRoos: 'false', Description: 'GENERAL PURPOSE' },
        { Account: '03-3201', Amount: '624.44', Rate: '0.120000', IsMelloRoos: 'false', Description: 'HEMET UNIFIED SCHOOL B & I' },
        { Account: '03-9201', Amount: '16.13', Rate: '0.003100', IsMelloRoos: 'false', Description: 'MT SAN JACINTO JR COLLEGE' },
        { Account: '04-5301', Amount: '44.23', Rate: '0.008500', IsMelloRoos: 'false', Description: 'METROPOLITAN WATER EAST' },
        { Account: '68-0308', Amount: '2,533.86', Rate: '0.000000', IsMelloRoos: 'true', Description: 'FC CFD 2021-1 IA-2 HEMET USD MELLO ROOS' },
        { Account: '68-0479', Amount: '519.68', Rate: '0.000000', IsMelloRoos: 'true', Description: 'FC CFD 2021-02 HERITAGE POINTE MELLO ROOS' },
        { Account: '68-1377', Amount: '3.14', Rate: '0.000000', IsMelloRoos: 'false', Description: 'FLOOD CONTROL STORMWATER / CLEANWATER/SANTA ANA' },
        { Account: '68-2390', Amount: '572.04', Rate: '0.000000', IsMelloRoos: 'true', Description: 'HEMET CFD 2005-1 PUB SAFETY SERV MELLO-ROOS' },
        { Account: '68-4647', Amount: '22.14', Rate: '0.000000', IsMelloRoos: 'false', Description: 'V-WIDE REGIONAL FAC LMD 88-1' },
        { Account: '68-5305', Amount: '6.94', Rate: '0.000000', IsMelloRoos: 'false', Description: 'METRO WATER DISTRICT STANDBY EAST' },
        { Account: '68-5402', Amount: '11.50', Rate: '0.000000', IsMelloRoos: 'false', Description: 'EASTERN MUNIIPAL WATER DISTRICT  STDBY-COMBINED CHG' },
      ],
    },
  },
};

describe('the assessed total is checked against the county, not against itself', () => {
  it('confirms the composition from the base levy line', () => {
    const { assessed, report } = parseTitlePointTaxResult(ITEMISED)!;
    expect(assessed.basis).toBe('levy');
    expect(assessed.impliedNet).toBeCloseTo(520_370, 0);
    expect(assessed.composedNet).toBe(520_370);
    expect(report.assessedValue).toBe(527_370);
  });

  it('suppresses the total when the base levy contradicts the composition', () => {
    // Improvements overstated by 100k: the county's own line says otherwise.
    const r = parseTitlePointTaxResult({
      TaxReport: { ...ITEMISED.TaxReport, ImprovementsValuation: '549,343.00' },
    })!;
    expect(r.assessed.basis).toBe('mismatch');
    expect(r.assessed.total).toBeNull();
    expect(r.report.assessedValue).toBeNull();
    // The split still prints — a gap, not a blank page — and it still earns one.
    expect(r.report.landValue).toBe(78_027);
    expect(taxReportHasContent(r.report)).toBe(true);
  });

  it('still prints a total when there is no base levy line to check it', () => {
    // 84% of parcels do not itemise. Suppressing the figure on all of them to
    // avoid one that cannot be proved would discard a correct number: the rule
    // holds on 204 of 207 wherever it CAN be checked.
    const r = parseTitlePointTaxResult(REAL)!;
    expect(r.assessed.basis).toBe('composed');
    expect(r.assessed.total).toBe(956_572);
    expect(r.assessed.impliedNet).toBeNull();
  });

  it('does not mistake a school bond rate for the base levy', () => {
    // 0.12% would imply a net of 520,366,666. The window is 0.99–1.01.
    const r = parseTitlePointTaxResult({
      TaxReport: {
        ...ITEMISED.TaxReport,
        Liens: { Item: [ITEMISED.TaxReport.Liens.Item[1], ITEMISED.TaxReport.Liens.Item[2]] },
      },
    })!;
    expect(r.assessed.basis).toBe('composed');
  });

  it('prints a vendor-stated total without any arithmetic of ours', () => {
    const r = parseTitlePointTaxResult({
      TaxReport: { ...ITEMISED.TaxReport, AssessedValuation: '1,000,000.00' },
    })!;
    expect(r.assessed.basis).toBe('stated');
    expect(r.assessed.total).toBe(1_000_000);
  });

  it('reports absent, not mismatch, when there is nothing to compose', () => {
    const r = parseTitlePointTaxResult({
      TaxReport: { ...ITEMISED.TaxReport, LandValuation: '', ImprovementsValuation: '' },
    })!;
    expect(r.assessed.basis).toBe('absent');
    expect(r.assessed.total).toBeNull();
  });
});

// ─── `Liens` is the whole bill, not a list of special assessments ───────────

describe('only fixed-dollar lines are shown as direct assessments', () => {
  it('leaves the base levy and the school bond out', () => {
    // Printing "GENERAL PURPOSE $5,203.70" under special assessments tells a
    // homeowner their base property tax is a special assessment. It happens on
    // 16.1% of parcels, which is where the base line appears.
    const r = parseTitlePointTaxResult(ITEMISED)!;
    const shown = r.report.specialAssessments.map((a) => a.description);
    expect(shown).not.toContain('GENERAL PURPOSE');
    expect(shown).not.toContain('HEMET UNIFIED SCHOOL B & I');
    expect(shown).not.toContain('MT SAN JACINTO JR COLLEGE');
    expect(shown).not.toContain('METROPOLITAN WATER EAST');
  });

  it('keeps every rate-zero line, including the ones that are not Mello-Roos', () => {
    // Seven of the eleven are fixed-dollar: three Mello-Roos districts, flood
    // control, a landscape district and two water standby charges.
    const r = parseTitlePointTaxResult(ITEMISED)!;
    expect(r.report.specialAssessments).toHaveLength(7);
    expect(r.report.specialAssessments[0]!.amount).toBe(2533.86);
  });

  it('the two halves reproduce the bill, which is why Rate is the discriminator', () => {
    // 639 of 639 complete blocks do this. If it ever stops holding, the split
    // is wrong and the page is misattributing lines.
    const num = (s: string) => Number(s.replace(/,/g, ''));
    const lines = ITEMISED.TaxReport.Liens.Item;
    const adValorem = lines.filter((l) => num(l.Rate) > 0).reduce((a, l) => a + num(l.Amount), 0);
    const fixed = lines.filter((l) => num(l.Rate) === 0).reduce((a, l) => a + num(l.Amount), 0);
    expect(adValorem).toBeCloseTo(5888.50, 2);
    expect(fixed).toBeCloseTo(3669.30, 2);
    expect(adValorem + fixed).toBeCloseTo(num(ITEMISED.TaxReport.TotalTax), 2);
  });

  it('reports the Mello-Roos total, which is INSIDE the annual amount', () => {
    // The wording question: the Liens block sums to TotalTax, so the special
    // tax is a line WITHIN the figure page 4 prints as the annual amount — not
    // something a reader should add to it. Three districts on this parcel.
    expect(melloRoosTotal(ITEMISED)).toBeCloseTo(3625.58, 2);
    const liensSum = ITEMISED.TaxReport.Liens.Item
      .reduce((a, l) => a + Number(l.Amount.replace(/,/g, '')), 0);
    expect(liensSum).toBeCloseTo(9557.80, 2);
    expect(liensSum).toBeCloseTo(Number(ITEMISED.TaxReport.TotalTax.replace(/,/g, '')), 2);
    // So the special tax is strictly less than the annual amount it sits in.
    expect(melloRoosTotal(ITEMISED)!).toBeLessThan(liensSum);
  });

  it('returns null where there is no district', () => {
    expect(melloRoosTotal(REAL)).toBeNull();
  });
});

describe('the shapes that would fail silently', () => {
  it('reads a single Item that is an object rather than an array', () => {
    // Supplementals is an object on 2 of the 5 payloads that have it. Read as
    // an array it yields nothing and the page quietly loses a row.
    const one = {
      TaxReport: {
        ...REAL.TaxReport,
        Supplementals: { Item: { Type: 'Secured', DueToDescription: 'CHANGE OF OWNERSHIP', TotalInstallmentBalance: '77.2500' } },
      },
    };
    const r = parseTitlePointTaxReport(one)!;
    expect(r.supplementals).toHaveLength(1);
    expect(r.supplementals[0]).toMatchObject({ description: 'CHANGE OF OWNERSHIP', amount: 77.25 });
  });

  it('treats empty-string blocks as absent, not as one blank row', () => {
    // Bonds, SpecialAssessments and Supplementals are all "" on most payloads.
    const r = parseTitlePointTaxReport(REAL)!;
    expect(r.bonds).toEqual([]);
    expect(r.supplementals).toEqual([]);
  });

  it('rejects TitlePoint’s 1/1/0001 placeholder date', () => {
    const r = parseTitlePointTaxReport({ TaxReport: { ...REAL.TaxReport, RunDate: '1/1/0001', IssueDate: '1/1/0001' } })!;
    expect(r.asOf).toBeNull();
  });

  it('returns a contentless report rather than null when the county has nothing', () => {
    // "could not parse" and "nothing on record" are different answers, and the
    // caller records them differently.
    const empty = parseTitlePointTaxReport({ TaxReport: { APN: '1234-567-890', TaxYear: '2026-2027', TotalTax: '', Installments: '' } })!;
    expect(empty).not.toBeNull();
    expect(taxReportHasContent(empty)).toBe(false);
    expect(resolveTaxLayer({} as NormalizedTax, 'CA', empty)).toBeNull();
  });

  it('returns null only when the payload is not a tax result', () => {
    expect(parseTitlePointTaxReport(null)).toBeNull();
    expect(parseTitlePointTaxReport('a string')).toBeNull();
    expect(parseTitlePointTaxReport([{ TaxReport: {} }])).toBeNull();
    expect(parseTitlePointTaxReport({ LvReport: {} })).toBeNull();
  });

  it('does not mistake a zero valuation for a figure', () => {
    const r = parseTitlePointTaxReport({
      TaxReport: { ...REAL.TaxReport, LandValuation: '0.00', ImprovementsValuation: '0.00' },
    })!;
    expect(r.landValue).toBeNull();
    expect(r.improvementValue).toBeNull();
    // And so there is no composed total either.
    expect(r.assessedValue).toBeNull();
  });
});
