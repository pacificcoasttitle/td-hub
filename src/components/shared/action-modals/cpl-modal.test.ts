import { describe, expect, it } from 'vitest';
import { detailStrings, failureMessage } from './cpl-modal';

// ─── The operator must be told what actually went wrong ─────────────────────
//
// The bug these exist to prevent: the modal read
//
//   body.error ?? body.details?.[0]
//
// and `error` is a non-empty literal on every failure branch, so `??` never
// fell through and `details` was unreachable. The operator saw "CPL generation
// failed" while the actionable reason sat in cpl_error_logs.
//
// The first test below fails against that old expression. That is the point of
// it — a test that cannot distinguish the fixed code from the broken code
// proves nothing.

describe('failureMessage surfaces the specific reason, not the generic label', () => {
  it('the real 422 shape — the vendor reason reaches the operator', () => {
    const msg = failureMessage({
      error: 'CPL generation failed',
      details: ['Westcor CPL error: PolicyProducingAgentNumber is missing, validation failed for the Agency.'],
    });
    expect(msg).toContain('PolicyProducingAgentNumber is missing');
    // The class of failure stays visible as a prefix.
    expect(msg).toContain('CPL generation failed');
  });

  it('the real 400 shape — Zod issues are objects, not strings', () => {
    const msg = failureMessage({
      error: 'Invalid parameters',
      details: [{ path: ['lenderCompany'], message: 'Required' }],
    });
    expect(msg).toBe('Invalid parameters: lenderCompany: Required');
  });

  it('the real 500 shape — nothing specific exists, so the label stands alone', () => {
    expect(failureMessage({ error: 'Internal server error' })).toBe('Internal server error');
  });

  it('several reasons are all shown, not just the first', () => {
    const msg = failureMessage({
      error: 'CPL generation failed',
      details: ['Street address is a required field!', 'Zip code is a required field!'],
    });
    expect(msg).toContain('Street address');
    expect(msg).toContain('Zip code');
  });

  it('a body with nothing usable still says something', () => {
    expect(failureMessage({})).toBe('Generation failed');
    expect(failureMessage(null)).toBe('Generation failed');
    expect(failureMessage({ error: '   ' })).toBe('Generation failed');
  });
});

describe('detailStrings copes with both shapes the API sends', () => {
  it('keeps strings, renders Zod issues, drops junk', () => {
    expect(detailStrings(['a', { message: 'b', path: ['x'] }, { message: 'c' }, {}, '', 42]))
      .toEqual(['a', 'x: b', 'c']);
  });

  it('a non-array is not a detail list', () => {
    expect(detailStrings(undefined)).toEqual([]);
    expect(detailStrings('boom')).toEqual([]);
  });
});
