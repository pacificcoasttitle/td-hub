import { describe, expect, it } from 'vitest';
import type { NormalizedSubject, NormalizedTax, NormalizedTransfer } from '../normalize';
import {
  acres, californiaInstallments, compRange, currentVestingDeed, lotCoverage,
  parseLegal, parseOwners, readingOrder, taxShare, transferCounts,
} from './derive';

// The v3 redesign splits three stored strings into separate cells. The spec
// called them "Stored"; they are parsers, and a parser that guesses puts a
// confident wrong value on a title company's document. These tests are mostly
// about what it must REFUSE to parse.

describe('owner names in reading order', () => {
  it('moves the surname to the end — the whole point', () => {
    // The real 24 Aug payload.
    expect(readingOrder('CHRISTENSEN ELWOOD N')).toBe('Elwood N Christensen');
    expect(readingOrder('NODEL JUDITH K')).toBe('Judith K Nodel');
  });

  it('handles the comma form without reordering twice', () => {
    expect(readingOrder('CHRISTENSEN, ELWOOD N')).toBe('Elwood N Christensen');
  });

  it('keeps a suffix after the surname', () => {
    // "Jr Elwood Christensen" would be the naive result.
    expect(readingOrder('CHRISTENSEN ELWOOD JR')).toBe('Elwood Christensen Jr');
    expect(readingOrder('SMITH JOHN III')).toBe('John Smith Iii');
  });

  it('NEVER reorders an entity', () => {
    // "Company Pacific Coast Title" is the failure this prevents.
    expect(readingOrder('PACIFIC COAST TITLE COMPANY')).toBe('Pacific Coast Title Company');
    expect(readingOrder('CHRISTENSEN FAMILY TRUST')).toBe('Christensen Family Trust');
    expect(readingOrder('ACME HOLDINGS LLC')).toBe('Acme Holdings Llc');
    expect(readingOrder('BANK OF AMERICA')).toBe('Bank Of America');
  });

  it('leaves a single word alone', () => {
    expect(readingOrder('CHRISTENSEN')).toBe('Christensen');
  });

  it('returns empty for nothing, rather than inventing a name', () => {
    expect(readingOrder('')).toBe('');
    expect(readingOrder('   ')).toBe('');
  });
});

describe('splitting the vesting string', () => {
  it('splits the two owners the payload actually carries', () => {
    const owners = parseOwners('CHRISTENSEN ELWOOD N; NODEL JUDITH K');
    expect(owners).toHaveLength(2);
    expect(owners[0]).toEqual({ recorded: 'CHRISTENSEN ELWOOD N', display: 'Elwood N Christensen' });
    expect(owners[1]).toEqual({ recorded: 'NODEL JUDITH K', display: 'Judith K Nodel' });
  });

  it('keeps the recorded form verbatim alongside the display form', () => {
    // The page prints both; the recorded one is what a searcher matches on.
    expect(parseOwners('CHRISTENSEN ELWOOD N')[0]!.recorded).toBe('CHRISTENSEN ELWOOD N');
  });

  it('does NOT split on an ampersand', () => {
    // "SMITH JOHN & MARY" is one vesting of two people sharing a surname.
    // Splitting would invent a "Mary" with no surname at all.
    const owners = parseOwners('SMITH JOHN & MARY');
    expect(owners).toHaveLength(1);
    expect(owners[0]!.recorded).toBe('SMITH JOHN & MARY');
  });

  it('returns nothing for an absent owner, so the page renders its gap', () => {
    expect(parseOwners(null)).toEqual([]);
    expect(parseOwners('')).toEqual([]);
    expect(parseOwners('  ;  ')).toEqual([]);
  });
});

describe('the legal description', () => {
  it('pulls tract and lot from the real string', () => {
    expect(parseLegal('TRACT # 14627 LOT 52')).toEqual({
      tract: '14627', lot: '52', asRecorded: 'TRACT # 14627 LOT 52',
    });
  });

  it('copes without the hash', () => {
    expect(parseLegal('TRACT 14627 LOT 52')?.tract).toBe('14627');
  });

  it('PREFERS the structured fields, which the payload actually carries', () => {
    // SiteX sends TractNumber "6654" and LotNumber "44" alongside the brief
    // description. Parsing the string was solving a problem that does not
    // exist — and solving it wrongly. The string stays as the as-recorded line.
    expect(parseLegal('TRACT NO 6654 LOT 44', { tractNumber: '6654', lotNumber: '44' })).toEqual({
      tract: '6654', lot: '44', asRecorded: 'TRACT NO 6654 LOT 44',
    });
  });

  it('trusts the structured fields even when the string disagrees', () => {
    // If they ever diverge, the structured value is the one SiteX asserts.
    expect(parseLegal('SOMETHING ELSE ENTIRELY', { tractNumber: '99', lotNumber: '7' })?.tract).toBe('99');
  });

  it('renders the tiles from structured fields with no brief description at all', () => {
    expect(parseLegal(null, { tractNumber: '6654', lotNumber: '44' })).toEqual({
      tract: '6654', lot: '44', asRecorded: '',
    });
  });

  it('falls back to the string when the structured fields are empty', () => {
    expect(parseLegal('TRACT NO 6654 LOT 44', { tractNumber: null, lotNumber: null })?.tract).toBe('6654');
    expect(parseLegal('TRACT NO 6654 LOT 44', { tractNumber: '  ', lotNumber: '' })?.tract).toBe('6654');
  });

  it('reads "TRACT NO 6654" — the form our own payloads actually use', () => {
    // The mock's sample says "TRACT # 14627"; both live profiles say
    // "TRACT NO 6654". An earlier version captured "NO" as the tract number
    // on every one of our own profiles, and the fixtures could not see it.
    expect(parseLegal('TRACT NO 6654 LOT 44')).toEqual({
      tract: '6654', lot: '44', asRecorded: 'TRACT NO 6654 LOT 44',
    });
    expect(parseLegal('TRACT NO. 6654 LOT 44')?.tract).toBe('6654');
    expect(parseLegal('TRACT NUMBER 6654')?.tract).toBe('6654');
  });

  it('refuses a tract with no digit in it, rather than printing a word', () => {
    // This is the guard that turns the "NO" bug into an em dash if some other
    // filler word appears.
    expect(parseLegal('TRACT UNKNOWN LOT 44')?.tract).toBeNull();
    expect(parseLegal('TRACT NO LOT 44')?.tract).toBeNull();
  });

  it('REFUSES to guess when the shape is different, but still prints the string', () => {
    // Metes and bounds, a rancho, condominium airspace — all real, none of
    // them parseable into tract and lot.
    const l = parseLegal('POR OF RANCHO SAN PEDRO ALLOT 12 M R 3/47');
    expect(l?.tract).toBeNull();
    expect(l?.asRecorded).toBe('POR OF RANCHO SAN PEDRO ALLOT 12 M R 3/47');
  });

  it('does not read the LOT in LOT SIZE as a lot number', () => {
    expect(parseLegal('LOT SIZE 6625 SF')?.lot).toBeNull();
  });

  it('returns null for an absent description', () => {
    expect(parseLegal(null)).toBeNull();
    expect(parseLegal('   ')).toBeNull();
  });
});

describe('the land figures', () => {
  it('converts to acres', () => {
    expect(acres(6625)!).toBeCloseTo(0.1521, 4);
  });

  it('gives the coverage the mock prints', () => {
    // 1,487 of 6,625 is 22%.
    expect(Math.round(lotCoverage(1487, 6625)! * 100)).toBe(22);
  });

  it('refuses a coverage above 100% rather than asserting it', () => {
    // Multi-storey area against a small lot, or bad data. "142% of lot" is
    // absurd with a straight face.
    expect(lotCoverage(9000, 6625)).toBeNull();
  });

  it('returns null where a figure is missing', () => {
    expect(acres(null)).toBeNull();
    expect(acres(0)).toBeNull();
    expect(lotCoverage(null, 6625)).toBeNull();
    expect(lotCoverage(1487, null)).toBeNull();
  });
});

describe('tax share', () => {
  const tax = (over: Partial<NormalizedTax> = {}): NormalizedTax => ({
    year: 2025, assessedValue: 91843, landValue: 44507, improvementValue: 47336,
    marketValue: null, taxAmount: 1956, status: 'Current', ...over,
  });

  it('gives the 2.13% the mock prints', () => {
    expect((taxShare(tax())! * 100).toFixed(2)).toBe('2.13');
  });

  it('returns null rather than dividing by a missing assessment', () => {
    expect(taxShare(tax({ assessedValue: null }))).toBeNull();
    expect(taxShare(tax({ assessedValue: 0 }))).toBeNull();
    expect(taxShare(tax({ taxAmount: null }))).toBeNull();
  });
});

describe('the two California installments', () => {
  const tax: NormalizedTax = {
    year: 2025, assessedValue: 91843, landValue: null, improvementValue: null,
    marketValue: null, taxAmount: 1956, status: 'Current',
  };

  it('halves the annual and prints the statutory dates', () => {
    const [first, second] = californiaInstallments(tax, 'CA')!;
    expect(first!.amount).toBe(978);
    expect(first!.due).toBe('Nov 1, 2025');
    expect(first!.delinquentAfter).toBe('Dec 10, 2025');
    expect(second!.due).toBe('Feb 1, 2026');
    expect(second!.delinquentAfter).toBe('Apr 10, 2026');
  });

  it('REFUSES any state but California', () => {
    // The dates are California statute. Printing them over Nevada tax would
    // be inventing a deadline. This is the guard for the day coverage grows.
    expect(californiaInstallments(tax, 'NV')).toBeNull();
    expect(californiaInstallments(tax, 'AZ')).toBeNull();
    expect(californiaInstallments(tax, null)).toBeNull();
    expect(californiaInstallments(tax, '')).toBeNull();
  });

  it('accepts the spelled-out state too', () => {
    expect(californiaInstallments(tax, 'California')).not.toBeNull();
  });

  it('still gives the rows when the amount is missing, so the dates show', () => {
    const [first] = californiaInstallments({ ...tax, taxAmount: null }, 'CA')!;
    expect(first!.amount).toBeNull();
    expect(first!.due).toBe('Nov 1, 2025');
  });

  it('returns null without a tax year, because the dates depend on it', () => {
    expect(californiaInstallments({ ...tax, year: null }, 'CA')).toBeNull();
  });
});

// ─── Transfers ──────────────────────────────────────────────────────────────

const tr = (over: Partial<NormalizedTransfer>): NormalizedTransfer => ({
  sourcePosition: 0, transactionType: null, documentType: null, recordingDate: null,
  contractDate: null, documentNumber: null, bookNumber: null, pageNumber: null,
  currentOwnerFlag: true, isForeclosure: false, raw: {} as never, ...over,
});

describe('counting the recorded documents', () => {
  // The thirteen records from the 24 Aug payload, as page 4 groups them.
  const thirteen = [
    tr({ sourcePosition: 0, transactionType: 'Assignment', recordingDate: '2025-10-28' }),
    tr({ sourcePosition: 1, transactionType: 'Foreclosure', recordingDate: '2022-05-20', isForeclosure: true }),
    tr({ sourcePosition: 2, transactionType: 'Foreclosure', documentType: 'Pre-Foreclosure', recordingDate: '2022-04-18', isForeclosure: true }),
    tr({ sourcePosition: 3, transactionType: 'Assignment', recordingDate: '2020-12-04' }),
    tr({ sourcePosition: 4, transactionType: 'Release', recordingDate: '2014-10-29' }),
    tr({ sourcePosition: 5, transactionType: 'Mortgage', recordingDate: '2014-10-01' }),
    tr({ sourcePosition: 6, transactionType: 'Release', recordingDate: '2014-05-05' }),
    tr({ sourcePosition: 7, transactionType: 'Mortgage', recordingDate: '2014-03-19', documentNumber: '14-0273395' }),
    tr({ sourcePosition: 8, transactionType: 'Transfer', documentType: 'Deed', recordingDate: '2014-03-19', documentNumber: '14-0273394' }),
    tr({ sourcePosition: 9, transactionType: 'Transfer', documentType: 'Deed', recordingDate: '2014-03-19', documentNumber: '14-0273393' }),
    tr({ sourcePosition: 10, transactionType: 'Mortgage', recordingDate: '2004-05-13' }),
    tr({ sourcePosition: 11, transactionType: 'Transfer', documentType: 'Deed', recordingDate: '1976-05-20' }),
    tr({ sourcePosition: 12, transactionType: 'Transfer', documentType: 'Deed', recordingDate: '1975-03-03' }),
  ];

  it('matches the counts on the mock', () => {
    const c = transferCounts(thirteen);
    expect(c.total).toBe(13);
    expect(c.deeds).toBe(4);
    expect(c.mortgages).toBe(3);
    expect(c.releasesAndAssignments).toBe(4);
    expect(c.foreclosure).toBe(2);
  });

  it('counts a foreclosure as a foreclosure and nothing else', () => {
    // It must not also land in deeds, or the tiles over-count.
    const c = transferCounts([tr({ transactionType: 'Foreclosure Deed', isForeclosure: true })]);
    expect(c.foreclosure).toBe(1);
    expect(c.deeds).toBe(0);
  });

  it('keeps total honest when a type cannot be classified', () => {
    // The four tiles need not sum to the total, and the page reads the total.
    const c = transferCounts([...thirteen, tr({ sourcePosition: 13, transactionType: 'Lis Pendens' })]);
    expect(c.total).toBe(14);
    expect(c.deeds + c.mortgages + c.releasesAndAssignments + c.foreclosure).toBe(13);
  });
});

describe('which deed current ownership rests on', () => {
  it('resolves the same-day tie the real payload contains', () => {
    // 14-0273394 and 14-0273393 are both deeds recorded 19 March 2014.
    // "The latest deed" does not separate them; the higher document number
    // is the later recording that day.
    const deeds = [
      tr({ sourcePosition: 9, transactionType: 'Transfer', documentType: 'Deed', recordingDate: '2014-03-19', documentNumber: '14-0273393' }),
      tr({ sourcePosition: 8, transactionType: 'Transfer', documentType: 'Deed', recordingDate: '2014-03-19', documentNumber: '14-0273394' }),
    ];
    expect(currentVestingDeed(deeds)?.documentNumber).toBe('14-0273394');
  });

  it('is stable whatever order the vendor sends them in', () => {
    const a = tr({ sourcePosition: 0, documentType: 'Deed', recordingDate: '2014-03-19', documentNumber: '14-0273393' });
    const b = tr({ sourcePosition: 1, documentType: 'Deed', recordingDate: '2014-03-19', documentNumber: '14-0273394' });
    expect(currentVestingDeed([a, b])?.documentNumber).toBe('14-0273394');
    expect(currentVestingDeed([b, a])?.documentNumber).toBe('14-0273394');
  });

  it('prefers the most recent date over the document number', () => {
    const older = tr({ sourcePosition: 0, documentType: 'Deed', recordingDate: '2014-03-19', documentNumber: '99-9999999' });
    const newer = tr({ sourcePosition: 1, documentType: 'Deed', recordingDate: '2020-01-02', documentNumber: '00-0000001' });
    expect(currentVestingDeed([older, newer])?.recordingDate).toBe('2020-01-02');
  });

  it('ignores mortgages and releases', () => {
    const only = [tr({ transactionType: 'Mortgage', recordingDate: '2025-01-01' }), tr({ transactionType: 'Release', recordingDate: '2025-02-01' })];
    expect(currentVestingDeed(only)).toBeNull();
  });

  it('returns null when there is no deed, so the page renders its absence', () => {
    expect(currentVestingDeed([])).toBeNull();
  });
});

// ─── The range ──────────────────────────────────────────────────────────────

describe('the comparable range', () => {
  const subject = { buildingArea: 1487 } as NormalizedSubject;
  const sel = (pricePerSqft: number | null) => ({ pricePerSqft } as never);
  const f = (rates: (number | null)[]) => ({ selected: rates.map(sel) } as never);

  it('reproduces the mock, from the comps own rates', () => {
    // $472 … $524 across 1,487 sf — the numbers printed on pages 1 and 6.
    const r = compRange(f([497, 504, 472, 524, 512]), subject, 504)!;
    expect(r.minPerSqft).toBe(472);
    expect(r.maxPerSqft).toBe(524);
    expect(Math.round(r.low!)).toBe(701_864);
    expect(Math.round(r.high!)).toBe(779_188);
    expect(Math.round(r.midpoint!)).toBe(749_448);
  });

  it('REFUSES to call one sale a range', () => {
    expect(compRange(f([497]), subject, 497)).toBeNull();
    expect(compRange(f([497, null]), subject, 497)).toBeNull();
  });

  it('gives the rates but no money when the subject has no area', () => {
    const r = compRange(f([472, 524]), { buildingArea: null } as NormalizedSubject, 504)!;
    expect(r.minPerSqft).toBe(472);
    expect(r.low).toBeNull();
    expect(r.midpoint).toBeNull();
  });

  it('ignores comps with no usable rate rather than treating them as zero', () => {
    const r = compRange(f([472, null, 524, 0]), subject, 504)!;
    expect(r.basedOn).toBe(2);
    expect(r.minPerSqft).toBe(472);
  });

  it('returns null when nothing was selected', () => {
    expect(compRange(f([]), subject, null)).toBeNull();
  });
});
