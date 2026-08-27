import { describe, expect, it } from 'vitest';
import {
  ESCROW_OFFICER_ROW_FIELDS,
  describeOfficerRowRejection,
  validateOfficerRowShape,
} from './officer-row-shape';

/**
 * Rows copied verbatim from the production `Escrow Officer` feed
 * (GetLookuptable, http://100.29.181.61:3000/api/, GET, 27 Aug 2026).
 */
const HEALTHY = {
  'Escrow officer/Closer': 'PCT\\lvidaca',
  'Office LookupCode': 'GLT',
  'Officer Name': 'Lupe Vidaca',
  'Email': 'lvidaca@pct.com',
  'Row State': 'Unchanged',
  'LastModifiedAt': '2026-05-12T20:30:24Z',
};

/** The real shifted row: no `Row State`, empty name, "Unchanged" sitting in `Email`. */
const SHIFTED = {
  'Escrow officer/Closer': 'PCT\\jgomez',
  'Office LookupCode': 'GLT',
  'Officer Name': '',
  'Email': 'Unchanged',
  'LastModifiedAt': '2026-05-12T20:30:24Z',
};

describe('validateOfficerRowShape', () => {
  it('accepts every well-formed row on the live feed', () => {
    const live = [
      { ...HEALTHY, 'Escrow officer/Closer': 'PCT\\aayala', 'Office LookupCode': 'OCT', 'Officer Name': 'Analleli Ayala', Email: 'aayala@pct.com' },
      { ...HEALTHY, 'Escrow officer/Closer': 'PCT\\aballesteros', 'Office LookupCode': 'PRV', 'Officer Name': 'Anna Ballesteros', Email: 'aballesteros@pct.com' },
      { ...HEALTHY, 'Escrow officer/Closer': 'PCT\\cquintanar', 'Office LookupCode': 'OCT', 'Officer Name': 'Christine Quintanar', Email: 'cquintanar@pct.com' },
      { ...HEALTHY, 'Escrow officer/Closer': 'PCT\\kcasco', 'Office LookupCode': 'ONT', 'Officer Name': 'Karla Casco', Email: 'kcasco@pct.com' },
      HEALTHY,
    ];
    for (const row of live) {
      expect(validateOfficerRowShape(row, ESCROW_OFFICER_ROW_FIELDS), row['Escrow officer/Closer']).toEqual({ ok: true });
    }
  });

  it('rejects the column-shifted Gomez row', () => {
    const result = validateOfficerRowShape(SHIFTED, ESCROW_OFFICER_ROW_FIELDS);
    expect(result.ok).toBe(false);
  });

  // Three independent parts of the contract fail on this one row. Any one of
  // them alone would have caught it; asserting all three keeps the guard from
  // silently degrading to a single narrow test.
  it('names the missing column, the empty column, and the sentinel leak', () => {
    const result = validateOfficerRowShape(SHIFTED, ESCROW_OFFICER_ROW_FIELDS);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("'Row State' is absent"),
      expect.stringContaining("'Officer Name' is present but empty"),
      expect.stringContaining('Row State sentinel'),
    ]));
  });

  // The whole point of a shape guard over an 'Unchanged'-in-email check.
  it('rejects a shifted row whose displaced email looks plausible', () => {
    const plausible = {
      'Escrow officer/Closer': 'PCT\\someone',
      'Office LookupCode': 'GLT',
      'Officer Name': 'someone@pct.com',
      'Email': 'GLT',
      'Row State': 'Unchanged',
    };
    const result = validateOfficerRowShape(plausible, ESCROW_OFFICER_ROW_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("'Officer Name' holds an email address"),
      expect.stringContaining("'Email' does not hold an email address"),
    ]));
  });

  it('rejects a row missing only the trailing column', () => {
    const noRowState = { ...HEALTHY } as Record<string, string>;
    delete noRowState['Row State'];
    expect(validateOfficerRowShape(noRowState, ESCROW_OFFICER_ROW_FIELDS).ok).toBe(false);
  });

  it('accepts a row whose Row State is a sentinel other than Unchanged', () => {
    expect(validateOfficerRowShape({ ...HEALTHY, 'Row State': 'Modified' }, ESCROW_OFFICER_ROW_FIELDS))
      .toEqual({ ok: true });
  });

  // Stated as a limitation in the module docs; pinned here so it is a known
  // gap rather than an assumed capability.
  it('does NOT catch wrong-but-well-formed content', () => {
    const wrongBranch = { ...HEALTHY, 'Office LookupCode': 'OCT' };
    expect(validateOfficerRowShape(wrongBranch, ESCROW_OFFICER_ROW_FIELDS)).toEqual({ ok: true });
  });
});

describe('describeOfficerRowRejection', () => {
  it('names the officer, says the row was rejected for shape, and says escalate', () => {
    const message = describeOfficerRowRejection('PCT\\jgomez', ["column 'Row State' is absent from the row"]);
    expect(message).toContain('PCT\\jgomez');
    expect(message).toContain('REJECTED for shape');
    expect(message).toContain('not imported');
    expect(message).toContain('SoftPro');
  });
});
