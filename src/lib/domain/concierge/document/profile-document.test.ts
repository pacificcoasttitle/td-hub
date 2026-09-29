import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ProfileDocument, TEMPLATE_VERSION, pageNo, pagesFor } from './profile-document';
import type { ProfileDocumentInput } from './profile-document';
import type { NormalizedTaxReport } from './derive';

// ─── The document had no rendering test ─────────────────────────────────────
//
// Every guard on this feature asserted SOURCE TEXT of render.ts — that it does
// not import SiteX, does not call fetch, does not write a credit. All correct,
// and all silent about what comes out on the page: the whole v2 -> v3
// restructure passed 262 tests without one of them looking at a PDF.
//
// These render the real component and read the text back out, which is the
// only thing that can answer "is this on the page".

/** Text of a rendered document, squashed, plus its page count. */
async function render(input: ProfileDocumentInput): Promise<{ text: string; pages: number; parts: string[] }> {
  const buf = await renderToBuffer(ProfileDocument(input));
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    parts.push(c.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  return { text: parts.join(' ').replace(/\s+/g, ''), pages: doc.numPages, parts };
}

/**
 * The first line of each sheet, for an overflow failure message.
 *
 * "expected 9 to be 8" does not say WHICH page spilled, and finding out meant
 * re-rendering by hand. A spilled page shows as two sheets whose openings are
 * the same band, or one that starts mid-sentence.
 */
const headings = (parts: string[]) =>
  parts.map((t, i) => `    ${i + 1}. ${t.trim().replace(/\s+/g, ' ').slice(0, 70)}`).join('\n');
const sq = (s: string) => s.replace(/\s+/g, '');

/** A 1x1 PNG. Scaled by the style, so it occupies the real map height. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const SUBJECT = {
  apn: '8378-014-021', fips: '06037', county: 'LOS ANGELES',
  useCode: '0101', useDescription: 'Single Family Residential',
  primaryOwner: 'HERNANDEZ, GERARDO', siteAddress: '1420 Stonybrook Dr',
  siteCityState: 'La Verne, CA', legalDescription: 'TRACT NO 6654 LOT 14',
  tractNumber: '6654', lotNumber: '14', block: null, subdivision: null,
  beds: 3, baths: 2, buildingArea: 786, lotSize: 6625, lotSizeLabel: null,
  yearBuilt: 1949, latitude: 34.1, longitude: -117.7,
  lastSaleDate: '2015-12-23', lastSalePrice: 369_000, lastSalePricePerSqft: 469,
};

/** Tax status is POPULATED on purpose — see the vacuity check below. */
const TAX = {
  year: 2025, assessedValue: 436_812, landValue: 344_125, improvementValue: 92_687,
  marketValue: 0, taxAmount: 5394.23, status: 'DELINQUENT',
};

const comp = (i: number) => ({
  sourcePosition: i, salePrice: 500_000 + i * 17_000, pricePerSqft: 500 + i * 7,
  recordingDate: `2026-0${(i % 9) + 1}-04`, documentNumber: `26-${i}`, documentType: 'GRANT DEED',
  buildingArea: 1000 + i * 40, bedrooms: 3, baths: 2, yearBuilt: 1950 + i, lotSize: 6000,
  useDescription: 'Single Family Residential', proximityMiles: 0.2 + i * 0.13,
  latitude: 34.1, longitude: -117.7,
  address: `${1400 + i * 22} Stonybrook Drive`, city: 'La Verne', state: 'CA', zip: '91750',
});

/**
 * FIVE comparables, which is the default maxComps.
 *
 * The first version of this fixture had ONE. Every layout assertion passed on
 * it, and the same code rendered NINE sheets on the real payload's four comps
 * because the summary page overflowed — the table is the one block whose
 * height is not fixed, so a one-row table proves nothing about the page. A
 * fixture that cannot overflow cannot catch an overflow.
 */
const COMPS = [1, 2, 3, 4, 5].map(comp);

function input(over: Partial<ProfileDocumentInput> = {}): ProfileDocumentInput {
  return {
    subject: SUBJECT as ProfileDocumentInput['subject'],
    tax: TAX as ProfileDocumentInput['tax'],
    transfers: [{
      sourcePosition: 1, transactionType: 'RESALE', documentType: 'GRANT DEED',
      recordingDate: '2015-12-23', contractDate: null, documentNumber: '15-1611995',
      bookNumber: null, pageNumber: null, currentOwnerFlag: true, isForeclosure: false,
    }] as ProfileDocumentInput['transfers'],
    filter: {
      decisions: [], selected: COMPS,
      criteria: { sameUseCode: true, livingAreaPct: 25, bedDelta: 1, bathDelta: 1, radiusMiles: 1, months: 12, maxComps: 5 },
      counts: { returned: 12, qualified: 7, shown: COMPS.length },
    } as unknown as ProfileDocumentInput['filter'],
    metrics: {
      basedOnComps: COMPS.length, medianSalePrice: 551_000, medianPricePerSqft: 521,
      medianBuildingArea: 1120, medianYearBuilt: 1953, priceRangeMin: 517_000,
      priceRangeMax: 585_000, furthestSelectedMiles: 0.85, appliedRadiusMiles: 1,
      compsMissingPricePerSqft: 0,
    },
    criteria: { sameUseCode: true, livingAreaPct: 25, bedDelta: 1, bathDelta: 1, radiusMiles: 1, months: 12, maxComps: 5 },
    // A REAL IMAGE, not null. With compMapImage null the map branch never
    // renders and the small Absent box takes its place — so the overflow
    // guard passed happily with the map set to 420px, measuring a page that
    // had no map on it. Same vacuity as the one-comp fixture, one layer down.
    compMapImage: PIXEL, platMapImage: PIXEL, platMapStatus: null,
    preparedFor: { name: 'Jane Agent', company: 'Coast Realty' },
    presentingRep: { name: 'Gerardo Hernandez', email: 'g@pct.com', phone: '909-000-0000', title: 'Sales Executive' },
    generatedAt: new Date('2026-09-29T17:00:00Z'),
    capturedAt: new Date('2026-08-25T17:00:00Z'),
    sitexSearchId: 12345,
    ...over,
  };
}

const REPORT: NormalizedTaxReport = {
  taxYear: 2025, annualAmount: 5394.23, assessedValue: 436_812,
  landValue: 344_125, improvementValue: 92_687, taxRate: 1.2345,
  taxRateArea: '5-283', homeOwnerExemption: 7000,
  installments: [
    { number: '1st', amount: 2697.11, dueDate: '2025-11-01', status: 'DELINQUENT' },
    { number: '2nd', amount: 2697.12, dueDate: '2026-02-01', status: 'PAID' },
  ],
  specialAssessments: [{ description: 'VECTOR CONTROL', amount: 12.34, maturityDate: null }],
  bonds: [{ description: 'SCHOOL BOND 2016', amount: 210.5, maturityDate: '2031-07-01' }],
  supplementals: [],
  asOf: '2026-09-20',
};

describe('the fixture actually exercises what these tests claim', () => {
  // Rule 4. "The status never renders" proves nothing unless a status was
  // there to render. Every negative assertion below depends on these.
  it('carries a populated tax status on both layers', () => {
    expect(TAX.status).toBe('DELINQUENT');
    expect(REPORT.installments.some((i) => i.status === 'DELINQUENT')).toBe(true);
    expect(REPORT.installments.some((i) => i.status === 'PAID')).toBe(true);
  });

  it('carries tax figures, so the tax page is reachable at all', () => {
    expect(TAX.taxAmount).toBeGreaterThan(0);
    expect(TAX.assessedValue).toBeGreaterThan(0);
  });

  it('carries enough comparables to overflow a page if the layout is wrong', () => {
    // A one-comp fixture passed every layout assertion while the real payload
    // rendered nine sheets. The table is the only block whose height varies.
    expect(COMPS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('no page overflows into a second sheet', () => {
  // THE GUARD THAT WAS MISSING. Page numbers are computed, so a page that
  // spills produces a document with more sheets than TOTAL and two sheets
  // carrying the same "n of N" footer. Nothing else here would notice.
  it('renders exactly as many sheets as the page map says', async () => {
    const withTax = await render(input());
    expect(withTax.pages, `a page overflowed:\n${headings(withTax.parts)}`).toBe(pagesFor(true).length);

    const noTax = { year: null, assessedValue: null, landValue: null, improvementValue: null, marketValue: null, taxAmount: null, status: null };
    const without = await render(input({ tax: noTax as ProfileDocumentInput['tax'] }));
    expect(without.pages, `a page overflowed:\n${headings(without.parts)}`).toBe(pagesFor(false).length);
  });

  it('still fits with the fuller TitlePoint tax page', async () => {
    const r = await render(input({ taxReport: REPORT }));
    expect(r.pages, `a page overflowed:\n${headings(r.parts)}`).toBe(pagesFor(true).length);
  });
});

describe('page count follows the tax layer', () => {
  it('is eight pages with a tax record', async () => {
    const { pages, text } = await render(input());
    expect(pages).toBe(8);
    expect(text).toContain(sq('Property tax'));
    expect(text).toContain('8of8');
  });

  it('is SEVEN pages with no tax record, and has no tax page', async () => {
    const noTax = { year: null, assessedValue: null, landValue: null, improvementValue: null, marketValue: null, taxAmount: null, status: null };
    const { pages, text } = await render(input({ tax: noTax as ProfileDocumentInput['tax'] }));
    expect(pages).toBe(7);
    // Not an empty shell and not a "not available" tile — absent.
    // Scoped to TAX absences: "Comparable map not available" and "Parcel map
    // not available" are legitimate Absent boxes on other pages, and a bare
    // not.toContain('not available') failed on those rather than on anything
    // about tax.
    expect(text).not.toContain(sq('Property tax'));
    expect(text).not.toContain(sq('Assessment data only'));
    expect(text).not.toContain(sq('ANNUAL TAX'));
    expect(text).not.toContain(sq('Tax as share'));
    expect(text).toContain('7of7');
    // The footer must renumber. "of8" anywhere means a page kept a hard number.
    expect(text).not.toContain('of8');
  });

  it('a tax year alone does not make a tax page', async () => {
    // Every payload carries a TaxYear. If that counted as content the page
    // would render, empty, on every profile — layer 3 would be unreachable.
    const yearOnly = { year: 2025, assessedValue: null, landValue: null, improvementValue: null, marketValue: null, taxAmount: null, status: null };
    const { pages } = await render(input({ tax: yearOnly as ProfileDocumentInput['tax'] }));
    expect(pages).toBe(7);
  });
});

describe('payment status never reaches the page', () => {
  it('is absent on the SiteX layer', async () => {
    const { text } = await render(input());
    expect(text.toUpperCase()).not.toContain('DELINQUENT');
    expect(text.toUpperCase()).not.toContain('TAXSTATUS');
  });

  it('is absent on the TitlePoint layer, where instalments carry one each', async () => {
    const { text } = await render(input({ taxReport: REPORT }));
    expect(text.toUpperCase()).not.toContain('DELINQUENT');
    expect(text.toUpperCase()).not.toContain('PAID');
    // ...while the instalments themselves DID render, so the absence above is
    // about the status field and not about the section being missing.
    expect(text).toContain(sq('1st'));
    expect(text).toContain(sq('2nd'));
  });
});

describe('the middle layer announces itself', () => {
  it('says it is assessment data only, with an as-of date', async () => {
    const { text } = await render(input());
    expect(text).toContain(sq('Assessment data only'));
    expect(text).toContain(sq('August 25, 2026'));
  });

  it('does not say so when the full report is present', async () => {
    const { text } = await render(input({ taxReport: REPORT }));
    expect(text).not.toContain(sq('Assessment data only'));
    expect(text).toContain(sq('SPECIAL ASSESSMENTS'));
    expect(text).toContain(sq('BONDS'));
    expect(text).toContain(sq('matures'));
  });

  it('omits a line-item block entirely when it is empty', async () => {
    const { text } = await render(input({ taxReport: REPORT }));
    // supplementals is [] in the fixture.
    expect(REPORT.supplementals).toHaveLength(0);
    expect(text).not.toContain(sq('SUPPLEMENTAL BILLS'));
  });
});

describe('exemptions', () => {
  it("shows the homeowner's exemption and names no other category", async () => {
    const { text } = await render(input({ taxReport: REPORT }));
    expect(text).toContain(sq("Homeowner's exemption"));
    for (const banned of ['SENIOR', 'DISABLED', 'VETERAN', 'WIDOW', 'HOMESTEAD']) {
      expect(text.toUpperCase()).not.toContain(banned);
    }
  });

  it('omits the exemption block when there is none', async () => {
    const { text } = await render(input({ taxReport: { ...REPORT, homeOwnerExemption: null } }));
    expect(text).not.toContain(sq("Homeowner's exemption"));
  });
});

describe('the document states no value for this property', () => {
  it('has no midpoint, no estimate and no appraisal claim', async () => {
    const { text } = await render(input());
    for (const banned of ['Estimated value', 'estimated at', 'Midpoint', 'What the comparable sales suggest', 'How the range was built']) {
      expect(text).not.toContain(sq(banned));
    }
  });

  it("still reports the comparables' own per-sf range, which is market data", async () => {
    const { text } = await render(input());
    expect(text).toContain(sq('Per sf range'));
  });
});

describe('page 3 takes the price per sq ft from the vendor', () => {
  it('prints the supplied rate', async () => {
    const { text } = await render(input());
    expect(text).toContain(sq('Price per sf'));
    expect(text).toContain('$469');
  });

  it('prints no rate, and says why, when the vendor supplied none', async () => {
    const { text } = await render(input({ subject: { ...SUBJECT, lastSalePricePerSqft: null } as ProfileDocumentInput['subject'] }));
    // 369000 / 786 = $469. If that number appears, something computed it.
    expect(text).not.toContain('$469');
    expect(text).toContain(sq('more than one building area'));
  });
});

describe('the last recorded sale renders at all', () => {
  it('shows the sale rather than the no-sale callout', async () => {
    const { text } = await render(input());
    expect(text).toContain(sq('LAST RECORDED SALE'));
    expect(text).not.toContain(sq('No subject sale on record'));
    expect(text).toContain('$369,000');
  });
});

describe('the disclaimer gap is visible on the page', () => {
  it('prints a pending notice rather than nothing', async () => {
    const { text } = await render(input());
    expect(text).toContain(sq('Insurance Commissioner disclaimer pending'));
    expect(text).toContain(sq('not for external distribution'));
  });
});

describe('the template version is stamped and bumped', () => {
  it('is v3 and appears in the footer', async () => {
    expect(TEMPLATE_VERSION).toBe('v3');
    const { text } = await render(input());
    expect(text).toContain(sq(`Template ${TEMPLATE_VERSION}`));
  });
});

describe('page numbering is derived, not written down', () => {
  it('drops the tax page and shifts everything after it', () => {
    expect(pagesFor(true)).toHaveLength(8);
    expect(pagesFor(false)).toHaveLength(7);
    expect(pageNo('tax', true)).toBe(4);
    expect(pageNo('tax', false)).toBeNull();
    expect(pageNo('transfers', true)).toBe(5);
    expect(pageNo('transfers', false)).toBe(4);
    expect(pageNo('plat', true)).toBe(8);
    expect(pageNo('plat', false)).toBe(7);
  });

  it('keeps cross-references correct when the tax page is gone', async () => {
    const noTax = { year: null, assessedValue: null, landValue: null, improvementValue: null, marketValue: null, taxAmount: null, status: null };
    const { text } = await render(input({ tax: noTax as ProfileDocumentInput['tax'] }));
    // Comparable detail is page 6 of 7 — the summary must point at 5, not 6.
    expect(text).toContain(sq('as page 5'));
  });
});
