import { describe, expect, it } from 'vitest';
import { melloRoosLines, parseTitlePointTaxReport, parseTitlePointTaxResult } from './titlepoint-tax-report';
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

  it('the composed total reconciles against the tax the county billed', () => {
    // (land + improvements - exemption) x rate == TotalTax, to the cent.
    const taxable = r.assessedValue! - r.homeOwnerExemption!;
    const computed = taxable * (r.taxRate! / 100);
    expect(Math.abs(computed - r.annualAmount!)).toBeLessThan(0.01);
    expect(parseTitlePointTaxResult(REAL)!.assessed.basis).toBe('verified');
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

// ─── The guard on our own arithmetic ────────────────────────────────────────
//
// Measured over all 1,322 stored payloads: 1,247 carry all four parts, the
// identity holds to within a cent on 90% of them and within 0.5% on 97.9%, and
// the median error is $0.00. These tests hold the behaviour at the edges, where
// the 2% live.

describe('a total is printed only when it is verified', () => {
  const at = (over: Record<string, unknown>) =>
    parseTitlePointTaxResult({ TaxReport: { ...REAL.TaxReport, ...over } })!;

  it('suppresses the total when the arithmetic does not reconcile', () => {
    // Improvements overstated by 100k: the identity now misses by ~1,400 and
    // the reader must not be given a total we cannot stand behind.
    const r = at({ ImprovementsValuation: '585,573.00' });
    expect(r.assessed.basis).toBe('mismatch');
    expect(r.assessed.total).toBeNull();
    expect(r.report.assessedValue).toBeNull();
    // The split still prints. A gap, not a blank page.
    expect(r.report.landValue).toBe(470999);
    expect(r.report.improvementValue).toBe(585573);
    // And the two figures are kept so a real vendor problem can be told from a
    // rendering quirk months later.
    expect(r.assessed.expectedTax).toBeGreaterThan(0);
    expect(r.assessed.statedTax).toBe(13387.35);
  });

  it('accepts a half-percent drift, which is where the real data sits', () => {
    // 0.4% off: within tolerance, because rounding at the county is normal.
    const stated = (956572 - 7000) * (1.409829 / 100);
    const r = at({ TotalTax: (stated * 1.004).toFixed(2) });
    expect(r.assessed.basis).toBe('verified');
    expect(r.assessed.total).toBe(956572);
  });

  it('has a dollar floor, so a small bill is not held to a stricter standard', () => {
    // Half a percent of a $12 bill is six cents. A flat relative tolerance
    // would suppress totals on cheap parcels for rounding alone.
    const r = at({
      LandValuation: '500.00', ImprovementsValuation: '400.00',
      HomeOwnerExemption: '', TaxRate: '1.333333', TotalTax: '12.60',
    });
    expect(r.assessed.basis).toBe('verified');
    expect(r.assessed.total).toBe(900);
  });

  it('suppresses a total it cannot check at all', () => {
    // No rate, so the identity cannot be evaluated. Same risk as failing it:
    // the figure is ours, not the vendor's, and nothing has confirmed it.
    const r = at({ TaxRate: '' });
    expect(r.assessed.basis).toBe('unverifiable');
    expect(r.assessed.total).toBeNull();
    expect(r.report.landValue).toBe(470999);
  });

  it('prints a vendor-stated total without checking our own arithmetic', () => {
    // Never seen in 1,322 payloads, but if TitlePoint starts sending it then it
    // is their figure and the guard is not about their figures.
    const r = at({ AssessedValuation: '1,000,000.00' });
    expect(r.assessed.basis).toBe('stated');
    expect(r.assessed.total).toBe(1_000_000);
  });

  it('reports absent, not mismatch, when there is nothing to compose', () => {
    const r = at({ LandValuation: '', ImprovementsValuation: '' });
    expect(r.assessed.basis).toBe('absent');
    expect(r.assessed.total).toBeNull();
  });

  it('still earns a page on the split alone', () => {
    // Suppressing the total must not drop page 4 to layer 3.
    const r = at({ ImprovementsValuation: '585,573.00' });
    expect(taxReportHasContent(r.report)).toBe(true);
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
