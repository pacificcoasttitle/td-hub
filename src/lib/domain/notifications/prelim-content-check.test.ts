import { describe, expect, it } from 'vitest';
import {
  assessPrelimText,
  MIN_SUPPORTING_MARKERS,
  MIN_TEXT_CHARS,
} from './prelim-content-check';

/**
 * Fixtures are the first-page text SHAPE of the three documents actually
 * delivered in the Aug 4-11 window, taken from parsing the real files in S3.
 * Identifying details are replaced; the marker phrases the rule keys on are
 * verbatim, because those are what the rule must discriminate.
 */

// 20020828-GLT — genuine CLTA prelim, delivered 2026-08-10. MUST PASS.
const GENUINE_PRELIM_20020828 = `
CLTA Preliminary Report Form - Modified (11/17/06) Page 1
PRELIMINARY REPORT
In response to the above referenced application for a policy of title insurance,
this Company hereby reports that it is prepared to issue a Policy of Title Insurance
Effective Date: as of the date shown
The estate or interest in the land hereinafter described is: A FEE
Title to said estate or interest at the date hereof is vested in:
LEGAL DESCRIPTION
At the date hereof, exceptions to coverage in addition to the printed Exceptions
`.trim();

// 20020526-GLT — genuine CLTA prelim, delivered 2026-08-04. MUST PASS.
const GENUINE_PRELIM_20020526 = `
CLTA Preliminary Report Form - Modified (11/17/06) Page 1
PRELIMINARY REPORT
Policy of Title Insurance
Effective Date:
Title to said estate or interest at the date hereof is vested in:
LEGAL DESCRIPTION
Exceptions
`.trim();

// 20020875-GLT — dnu_140209.pdf, the 111-page internal bundle wrongly delivered
// to an external escrow officer on 2026-08-11. MUST FAIL.
const WRONG_DOCUMENT_20020875 = `
Order Summary
Document generated:08/11/26
Order number:20020875-GLT
Order type:Title only
Transaction type:Refinance
Settlement date:09/14/26at08:00 AM
Buyer/Borrower
Seller
Lender
Property Address
`.trim();

describe('the three documents from the Aug 4-11 window', () => {
  it('PASSES the genuine prelim delivered on Aug 10 (20020828-GLT)', () => {
    const r = assessPrelimText(GENUINE_PRELIM_20020828);
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('passed_strong_marker');
  });

  it('PASSES the genuine prelim delivered on Aug 4 (20020526-GLT)', () => {
    const r = assessPrelimText(GENUINE_PRELIM_20020526);
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('passed_strong_marker');
  });

  it('FAILS the wrong document delivered on Aug 11 (20020875-GLT)', () => {
    // The whole point. This is the 111-page internal title-search bundle.
    const r = assessPrelimText(WRONG_DOCUMENT_20020875);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('no_prelim_markers');
  });

  it('would not have been saved by a dnu_ filename filter', () => {
    // All three files carried a dnu_/DNU_ prefix. Two are legitimate. A prefix
    // filter blocks the good ones and still passes anything wrong under another
    // name — which is why the rule reads content, not names.
    expect(assessPrelimText(GENUINE_PRELIM_20020828).passed).toBe(true);
    expect(assessPrelimText(GENUINE_PRELIM_20020526).passed).toBe(true);
    expect(assessPrelimText(WRONG_DOCUMENT_20020875).passed).toBe(false);
  });
});

describe('marker rules', () => {
  it('passes on a strong marker alone', () => {
    const r = assessPrelimText('Preliminary Title Report for the property described herein, prepared for review.');
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('passed_strong_marker');
  });

  it(`passes on ${MIN_SUPPORTING_MARKERS} supporting markers without a strong one`, () => {
    const r = assessPrelimText(
      'Schedule B contains the Exceptions to coverage. The Legal Description follows, and title is vested in the parties named.',
    );
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('passed_supporting_markers');
  });

  it(`does NOT pass on fewer than ${MIN_SUPPORTING_MARKERS} supporting markers`, () => {
    // A grant deed carries "legal description" and "exceptions" language too —
    // two is not enough to call something a prelim.
    const r = assessPrelimText(
      'GRANT DEED. The legal description of the parcel is attached, subject to exceptions of record.',
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('no_prelim_markers');
  });
});

describe('unreadable documents route to review, not to a verdict', () => {
  it('reports no_text_layer for an empty or scanned document', () => {
    for (const v of ['', '   ', null, undefined, 'x'.repeat(MIN_TEXT_CHARS - 1)]) {
      const r = assessPrelimText(v as string);
      expect(r.passed).toBe(false);
      // Distinct from no_prelim_markers: a scanned prelim is a real thing and
      // needs a human, not a "this is the wrong document" conclusion.
      expect(r.reason).toBe('no_text_layer');
    }
  });

  it('never reports a pass for text it could not read', () => {
    expect(assessPrelimText(null).passed).toBe(false);
  });
});

describe('reporting surface', () => {
  it('returns marker ids and text length, never document content', () => {
    const r = assessPrelimText(GENUINE_PRELIM_20020828);
    expect(r.matched).toContain('preliminary_report');
    expect(r.textChars).toBeGreaterThan(0);
    // The assessment must not carry document text back to the caller/log.
    expect(JSON.stringify(r)).not.toContain('vested in');
  });
});
