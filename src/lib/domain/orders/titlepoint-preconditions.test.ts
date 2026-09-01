import { describe, expect, it } from 'vitest';
import {
  missingTitlePointInputs,
  describeMissingTitlePointInputs,
} from './titlepoint-preconditions';

// ─── The gate was three-way and only one door was watched ───────────────────
//
// create-order.ts reached TitlePoint through
// `address && state && county`, with no else. Any of the three missing meant
// no searches, no documents, and no record of why. Four of 27 live hub orders
// in seven days ended there.

describe('every door into the same hole is named', () => {
  const ok = { address: '760 N Brierwood Ave', state: 'CA', county: 'San Bernardino' };

  it('a complete order has nothing missing', () => {
    expect(missingTitlePointInputs(ok)).toEqual([]);
  });

  it('names county — the four live orders that lost their documents', () => {
    expect(missingTitlePointInputs({ ...ok, county: null })).toEqual(['county']);
  });

  it('names address and state, which the county field does not guard', () => {
    expect(missingTitlePointInputs({ ...ok, address: null })).toEqual(['address']);
    expect(missingTitlePointInputs({ ...ok, state: '' })).toEqual(['state']);
  });

  it('names all three when nothing is present', () => {
    expect(missingTitlePointInputs({})).toEqual(['address', 'state', 'county']);
  });

  it('whitespace is missing, not present', () => {
    // A county of "  " passed the old `&& county` check as truthy and then
    // produced a TitlePoint search with no locality.
    expect(missingTitlePointInputs({ ...ok, county: '   ' })).toEqual(['county']);
    expect(missingTitlePointInputs({ ...ok, address: '\t' })).toEqual(['address']);
  });

  it('the order of names is stable, so recorded reasons group', () => {
    expect(missingTitlePointInputs({ county: null, state: null, address: null }))
      .toEqual(['address', 'state', 'county']);
  });
});

describe('the recorded reason is written for the operator', () => {
  it('one missing input reads as a sentence', () => {
    const s = describeMissingTitlePointInputs(['county']);
    expect(s).toContain('property county');
    expect(s).toContain('is missing');
    expect(s).toContain('Add it on the order');
  });

  it('two and three read as a list', () => {
    expect(describeMissingTitlePointInputs(['address', 'county']))
      .toContain('property address and property county');
    expect(describeMissingTitlePointInputs(['address', 'state', 'county']))
      .toContain('property address, property state and property county');
    expect(describeMissingTitlePointInputs(['address', 'county'])).toContain('are missing');
  });

  it('nothing missing produces no note', () => {
    expect(describeMissingTitlePointInputs([])).toBe('');
  });

  it('it says what the operator has, not what the code did', () => {
    // The old behaviour left the operator with an order and no explanation.
    // A note naming an internal branch would be no better.
    const s = describeMissingTitlePointInputs(['county']);
    expect(s).not.toMatch(/autoTrigger|titlePointSessionId|else if|skipped/);
  });
});
