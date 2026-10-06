import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { readSource } from '@/test-support/read-source';
import {
  INSURANCE_DISCLAIMER, ProfileDocument, TEMPLATE_VERSION, pageNo, pagesFor,
  pricePerSqft, typeOf,
} from './profile-document';
import type { ProfileDocumentInput } from './profile-document';
import type { NormalizedTaxReport } from './derive';

// ─── Rendered and read back ─────────────────────────────────────────────────
//
// Every guard on this feature used to assert SOURCE TEXT of render.ts — the
// wrong file entirely. A full v3 restructure walked through 262 of them
// untouched, and then a v6 rebuild found the same thing again. These render
// the real component and read the text out of the PDF.

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
const sq = (s: string) => s.replace(/\s+/g, '');

/** A 1x1 PNG, scaled by the style so it occupies the real image height. */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const headings = (parts: string[]) =>
  parts.map((t, i) => `    ${i + 1}. ${t.trim().replace(/\s+/g, ' ').slice(0, 70)}`).join('\n');

const SUBJECT = {
  apn: '8381-021-001', fips: '06037', county: 'LOS ANGELES',
  useCode: '1001', useDescription: 'Single Family Residential',
  primaryOwner: 'HERNANDEZ GERARDO J; MENDOZA YESSICA S',
  siteAddress: '1358 5TH ST', siteCityState: 'LA VERNE, CA 91750',
  legalDescription: 'TRACT NO 6654 LOT 44',
  tractNumber: '6654', lotNumber: '44', block: null, subdivision: null,
  beds: 2, baths: 1, buildingArea: 786, lotSize: 6155, lotSizeLabel: '6155 SF',
  yearBuilt: 1949, latitude: 34.105, longitude: -117.782,
  lastSaleDate: '2015-12-23', lastSalePrice: 369_000, lastSalePricePerSqft: 469,
  mailAddressFull: '1358 5TH ST, LA VERNE, CA 91750-4224',
  censusTract: '4089.00', garage: null, pool: null, zoning: 'LVPR4.5D*',
};

/** Tax status is POPULATED on purpose — the negative assertions need it. */
const TAX = {
  year: 2025, assessedValue: 436_812, landValue: 344_125, improvementValue: 92_687,
  marketValue: 0, taxAmount: 5394.23, status: 'DELINQUENT',
};

const comp = (i: number) => ({
  sourcePosition: i, salePrice: 500_000 + i * 17_000, pricePerSqft: 500 + i * 7,
  recordingDate: `2026-0${(i % 9) + 1}-04`, documentNumber: `26-${i}`, documentType: 'GRANT DEED',
  buildingArea: 900 + i * 40, bedrooms: 3, baths: 2, yearBuilt: 1950 + i, lotSize: 6000,
  useCodeDescription: 'Single Family Residential', proximityMiles: 0.2 + i * 0.13,
  latitude: 34.1, longitude: -117.7,
  address: `${1400 + i * 22} Stonybrook Drive`, city: 'La Verne', state: 'CA', zip: '91750',
});

/**
 * FIVE comparables, the default maxComps.
 *
 * An earlier fixture had ONE. Every layout assertion passed on it while the
 * real payload's four rendered nine sheets, because the table is the only
 * block whose height varies. EVIDENCE_RULES rule 7.
 */
const COMPS = [1, 2, 3, 4, 5].map(comp);

/** The 2015 deed the sale was recorded under, plus a LATER mortgage. */
const TRANSFERS = [
  {
    sourcePosition: 1, transactionType: 'RESALE', documentType: 'Deed',
    recordingDate: '2015-12-23', contractDate: null, documentNumber: '15-1611995',
    bookNumber: null, pageNumber: null, currentOwnerFlag: true, isForeclosure: false,
  },
  {
    sourcePosition: 2, transactionType: 'LOAN', documentType: 'Mortgage',
    recordingDate: '2024-02-01', contractDate: null, documentNumber: '24-0070807',
    bookNumber: null, pageNumber: null, currentOwnerFlag: false, isForeclosure: false,
  },
];

function input(over: Partial<ProfileDocumentInput> = {}): ProfileDocumentInput {
  return {
    subject: SUBJECT as ProfileDocumentInput['subject'],
    tax: TAX as ProfileDocumentInput['tax'],
    transfers: TRANSFERS as ProfileDocumentInput['transfers'],
    filter: {
      decisions: [], selected: COMPS,
      criteria: { sameUseCode: true, livingAreaPct: 30, bedDelta: 1, bathDelta: 1, radiusMiles: 1, months: 12, maxComps: 5 },
      counts: { returned: 25, qualified: 7, shown: COMPS.length },
    } as unknown as ProfileDocumentInput['filter'],
    metrics: {
      basedOnComps: COMPS.length, medianSalePrice: 551_000, medianPricePerSqft: 578,
      medianBuildingArea: 1020, medianYearBuilt: 1953, priceRangeMin: 517_000,
      priceRangeMax: 585_000, furthestSelectedMiles: 0.85, appliedRadiusMiles: 1,
      compsMissingPricePerSqft: 0,
    },
    criteria: { sameUseCode: true, livingAreaPct: 30, bedDelta: 1, bathDelta: 1, radiusMiles: 1, months: 12, maxComps: 5 },
    compMapImage: PIXEL, platMapImage: PIXEL, platMapStatus: null,
    preparedFor: { name: 'John Smith', company: 'Coast Realty' },
    presentingRep: { name: 'Mark Neveu', email: 'mneveu@pct.com', phone: '909-000-0000', title: 'Sales Representative' },
    generatedAt: new Date('2026-09-30T17:00:00Z'),
    capturedAt: new Date('2026-09-23T17:00:00Z'),
    sitexSearchId: 1408916630,
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
  // No district on this parcel — the common case, 91.4% of payloads.
  melloRoos: null,
  supplementals: [],
  asOf: '2026-09-20',
};

describe('the fixture exercises what these tests claim', () => {
  it('carries a populated payment status on both layers', () => {
    expect(TAX.status).toBe('DELINQUENT');
    expect(REPORT.installments.some((i) => i.status === 'DELINQUENT')).toBe(true);
    expect(REPORT.installments.some((i) => i.status === 'PAID')).toBe(true);
  });

  it('carries enough comparables to overflow a page if the layout is wrong', () => {
    expect(COMPS.length).toBeGreaterThanOrEqual(4);
  });

  it('has a later NON-ownership transfer than the sale', () => {
    // Without this, "most recent transfer shows one event" proves nothing.
    const newest = [...TRANSFERS].sort((a, b) => b.recordingDate.localeCompare(a.recordingDate))[0]!;
    expect(newest.recordingDate).toBe('2024-02-01');
    expect(newest.recordingDate).not.toBe(SUBJECT.lastSaleDate);
    expect(typeOf(newest)).toBe('mortgage');
  });

  it('renders real images, so an oversized one would overflow', () => {
    expect(PIXEL.startsWith('data:image/png')).toBe(true);
  });
});

describe('page count follows the tax layer, and nothing overflows', () => {
  it('is eight sheets with a tax record', async () => {
    const r = await render(input());
    expect(r.pages, `a page overflowed:\n${headings(r.parts)}`).toBe(pagesFor(true).length);
    expect(r.pages).toBe(8);
    expect(r.text).toContain(sq('PROPERTY TAX'));
  });

  it('is SEVEN sheets with no tax record, and has no tax page', async () => {
    const noTax = { year: null, assessedValue: null, landValue: null, improvementValue: null, marketValue: null, taxAmount: null, status: null };
    const r = await render(input({ tax: noTax as ProfileDocumentInput['tax'] }));
    expect(r.pages, `a page overflowed:\n${headings(r.parts)}`).toBe(7);
    expect(r.text).not.toContain(sq('PROPERTY TAX'));
    expect(r.text).not.toContain(sq('ASSESSED VALUE'));
    expect(r.text).toContain('7of7');
    expect(r.text).not.toContain('of8');
  });

  it('a tax year alone does not make a tax page', async () => {
    const yearOnly = { year: 2025, assessedValue: null, landValue: null, improvementValue: null, marketValue: null, taxAmount: null, status: null };
    const r = await render(input({ tax: yearOnly as ProfileDocumentInput['tax'] }));
    expect(r.pages).toBe(7);
  });

  it('still fits with the fuller TitlePoint tax page', async () => {
    const r = await render(input({ taxReport: REPORT }));
    expect(r.pages, `a page overflowed:\n${headings(r.parts)}`).toBe(8);
  });
});

describe('payment status never reaches the page', () => {
  it('is absent on the SiteX layer, and there is no "late after" column', async () => {
    const { text } = await render(input());
    expect(text.toUpperCase()).not.toContain('DELINQUENT');
    expect(text.toUpperCase()).not.toContain('LATEAFTER');
    expect(text.toUpperCase()).not.toContain('TAXSTATUS');
  });

  it('is absent on the TitlePoint layer, where instalments carry one each', async () => {
    const { text } = await render(input({ taxReport: REPORT }));
    expect(text.toUpperCase()).not.toContain('DELINQUENT');
    expect(text.toUpperCase()).not.toContain('PAID');
    // ...while the installments themselves DID render, so the absence is
    // about the status field and not about a missing section.
    expect(text).toContain(sq('1ST INSTALLMENT'));
    expect(text).toContain(sq('2ND INSTALLMENT'));
  });
});

describe('the disclaimer prints, and the pending box does not', () => {
  it('carries both Commissioner paragraphs verbatim', async () => {
    const { text } = await render(input());
    expect(INSURANCE_DISCLAIMER).toHaveLength(2);
    for (const para of INSURANCE_DISCLAIMER) {
      expect(text).toContain(sq(para));
    }
    expect(text).toContain(sq('California Insurance Commissioner'));
  });

  it('has no "pending" notice and no distribution warning', async () => {
    // That box printed on customer PDFs. It must not come back.
    const { text } = await render(input());
    expect(text.toLowerCase()).not.toContain(sq('disclaimer pending').toLowerCase());
    expect(text.toLowerCase()).not.toContain(sq('not for external distribution').toLowerCase());
  });
});

describe('price per sq ft is calculated', () => {
  it('divides sale price by living area', () => {
    // 369,000 / 786 = 469.46
    expect(pricePerSqft(369_000, 786)).toBeCloseTo(469.46, 1);
    expect(pricePerSqft(369_000, null)).toBeNull();
    expect(pricePerSqft(null, 786)).toBeNull();
    expect(pricePerSqft(369_000, 0)).toBeNull();
  });

  it('prints the calculated rate on the subject', async () => {
    const { text } = await render(input());
    expect(text).toContain(sq('Price per sq ft'));
    expect(text).toContain('$469');
  });

  it('still prints a rate when the vendor supplied none, because it is computed', async () => {
    const { text } = await render(input({
      subject: { ...SUBJECT, lastSalePricePerSqft: null } as ProfileDocumentInput['subject'],
    }));
    expect(text).toContain('$469');
  });
});

describe('most recent transfer describes ONE event', () => {
  it('takes the document number and type from the sale, not the newest row', async () => {
    const { text } = await render(input());
    // The sale is the 2015 deed. The newest record is a 2024 mortgage.
    expect(text).toContain(sq('15-1611995'));
    expect(text).toContain(sq('MOST RECENT TRANSFER'));
    const page3 = (await render(input())).parts[2]!.replace(/\s+/g, '');
    expect(page3).toContain('15-1611995');
    expect(page3).not.toContain('24-0070807');
  });
});

describe('v3 parts are gone', () => {
  it('has no lede sentences', async () => {
    const { text } = await render(input());
    for (const banned of ['A single-family home built in', 'These numbers stay the same', 'Same numbers as the map']) {
      expect(text).not.toContain(sq(banned));
    }
  });

  it('has no explainer boxes — the reason is a footnote', async () => {
    const { text } = await render(input());
    expect(text).not.toContain(sq('Assessment data only'));
    // The footnote used to say instalment amounts "were not available" while
    // two installment boxes sat above it. It now states what the page can
    // actually support: they are the annual total split by statute.
    expect(text).toContain(sq('Installments are the annual amount split per California statute'));
    expect(text).not.toContain(sq('were not available for this parcel'));
  });

  it('uses US spelling for installment throughout', () => {
    // v6 is a US customer document. "instalment" is the British form and was
    // in the section bar, the boxes and the footnote.
    //
    // readSource, so a rename fails loudly and the prose in this file's own
    // comments is not read as rendered copy.
    const src = readSource(
      join(process.cwd(), 'src/lib/domain/concierge/document/profile-document.tsx'),
      { mustContain: 'export function ProfileDocument' },
    );
    expect(src).not.toMatch(/\bINSTALMENT|\binstalment/);
  });

  it('states no value for this property', async () => {
    const { text } = await render(input());
    for (const banned of ['Estimated value', 'Midpoint', 'What the comparable sales suggest', 'How the range was built']) {
      expect(text).not.toContain(sq(banned));
    }
  });

  it('keeps the template version off the page', async () => {
    const { text } = await render(input());
    expect(TEMPLATE_VERSION).toBe('v4');
    expect(text).not.toContain(sq('Template v'));
    expect(text).not.toContain(sq('SiteX Title Profile_144'));
    // ...and the footer that replaced it is there.
    expect(text).toContain(sq('Data deemed reliable, but not guaranteed'));
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

  it('omits the block when there is none', async () => {
    const { text } = await render(input({ taxReport: { ...REPORT, homeOwnerExemption: null } }));
    expect(text).not.toContain(sq("Homeowner's exemption"));
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
});

describe('the cover never shows the comparables map', () => {
  it('leaves the photo area flat when there is no brand photo', async () => {
    // A map of other people's sales is not this property. The comp map is
    // supplied here and must appear only on page 6.
    const r = await render(input());
    expect(r.parts[0]!.replace(/\s+/g, '')).not.toContain('Stonybrook');
  });
});

// ─── Mello-Roos reaches the page ────────────────────────────────────────────
//
// The wording is held in titlepoint-tax-report.test.ts, where it is assembled.
// These render the real document and read the text back, because a correct
// sentence that never leaves the function is not a disclosure.

describe('the Mello-Roos disclosure', () => {
  // The county's strings exactly, as the parser now yields them — suffix, caps
  // and all. Using tidied names here would test a shape the parser never emits.
  const THREE = {
    districts: [
      'FC CFD 2021-1 IA-2 HEMET USD MELLO ROOS',
      'FC CFD 2021-02 HERITAGE POINTE MELLO ROOS',
      'HEMET CFD 2005-1 PUB SAFETY SERV MELLO-ROOS',
    ],
    total: 3625.58,
  };

  it('prints under its own heading when the parcel is in a district', async () => {
    const { text } = await render(input({ taxReport: { ...REPORT, melloRoos: THREE } }));
    expect(text.toUpperCase()).toContain(sq('COMMUNITY FACILITIES DISTRICT (MELLO-ROOS)'));
    expect(text).toContain(sq('within three Community Facilities Districts'));
    expect(text).toContain(sq('included in the annual property tax shown above'));
  });

  it('names every district on the page, not just the first', async () => {
    const { text } = await render(input({ taxReport: { ...REPORT, melloRoos: THREE } }));
    for (const d of THREE.districts) expect(text, d).toContain(sq(d));
  });

  it('does not tell the reader to add the figure to the annual tax', async () => {
    // The whole reason the wording changed: the special tax is already inside
    // the annual amount printed above it.
    const { text } = await render(input({ taxReport: { ...REPORT, melloRoos: THREE } }));
    expect(text).not.toContain(sq('in addition to the annual'));
    expect(text).toContain(sq('in addition to the base property tax'));
    expect(text).toContain(sq('Special taxes totalling'));
  });

  it('says nothing at all on a parcel with no district', async () => {
    // 91.4% of parcels. An absent district must leave no trace — not a heading,
    // not an empty box, not "none".
    const { text } = await render(input({ taxReport: { ...REPORT, melloRoos: null } }));
    expect(text.toUpperCase()).not.toContain('MELLO');
    expect(text.toUpperCase()).not.toContain('COMMUNITY FACILITIES');
  });

  it('is absent entirely on the SiteX layer, which has no such data', async () => {
    const { text } = await render(input({ taxReport: null }));
    expect(text.toUpperCase()).not.toContain('MELLO');
  });
});

// ─── cover-is-one-navy ──────────────────────────────────────────────────────
//
// The cover is two stacked blocks: the address block and the prepared-for /
// presented-by panel under it. They were #1B2A4A and #222A48 — close enough to
// look like a printing fault rather than a decision, and far enough apart to
// show a seam on the proof.
//
// This reads the SOURCE rather than the rendered page because react-pdf gives
// no way to ask a rendered View for its computed fill, and rasterising to
// sample a pixel would make a colour assertion depend on JPEG quantisation.
// The invariant is about which token the two blocks name, and that is in the
// source exactly.

describe('the cover is one navy', () => {
  const src = () => readSource(join(process.cwd(), 'src/lib/domain/concierge/document/profile-document.tsx'), {
    mustContain: 'backgroundColor: NAVY',
  });

  it('gives both cover blocks the same fill', () => {
    // THE COVER IS NOT THE FIRST <Page> IN THE FILE. Slicing to the first
    // </Page> found a different, earlier page and zero fills — the guard said
    // "stale" rather than passing on nothing, which is the only reason that
    // draft was caught.
    //
    // Anchored on the eyebrow instead, which only the cover has, and bounded by
    // the Page tags either side of it.
    const s = src();
    const eyebrow = s.indexOf('CONCIERGE PROPERTY PROFILE');
    expect(eyebrow, 'cover eyebrow not found — the guard is stale').toBeGreaterThan(0);
    const cover = s.slice(s.lastIndexOf('<Page', eyebrow), s.indexOf('</Page>', eyebrow));
    const fills = [...cover.matchAll(/backgroundColor:\s*([A-Za-z_][\w]*)/g)].map((m) => m[1]);

    expect(fills.length, 'no cover fills found — the guard is stale').toBeGreaterThanOrEqual(2);
    // COVER_FALLBACK is the photograph's stand-in and is deliberately its own
    // colour: it only shows when the image is missing, where matching the navy
    // would make an absent photo invisible rather than obvious.
    const blocks = fills.filter((f) => f !== 'COVER_FALLBACK');
    expect(new Set(blocks).size, `cover blocks use ${[...new Set(blocks)].join(' and ')}`).toBe(1);
    expect(blocks[0]).toBe('NAVY');
  });

  it('has no second name for the cover navy', () => {
    // Deleted rather than redefined to the same value: two names for one colour
    // is how they drift apart again.
    const parts = readSource(join(process.cwd(), 'src/lib/domain/concierge/document/parts.tsx'), { mustContain: 'export const NAVY' });
    expect(parts).not.toContain('COVER_PANEL');
    expect(src()).not.toContain('COVER_PANEL');
  });

  it('still keeps the photo fallback distinct, which is not the same mistake', () => {
    const parts = readSource(join(process.cwd(), 'src/lib/domain/concierge/document/parts.tsx'), { mustContain: 'export const COVER_FALLBACK' });
    const navy = /export const NAVY = '([^']+)'/.exec(parts)?.[1];
    const fallback = /export const COVER_FALLBACK = '([^']+)'/.exec(parts)?.[1];
    expect(navy).toBeTruthy();
    expect(fallback).toBeTruthy();
    expect(fallback).not.toBe(navy);
  });
});
