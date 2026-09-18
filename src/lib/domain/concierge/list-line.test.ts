import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA } from './comp-filter';
import { criteriaSummary, profileListSubject } from './list-line';

describe('the criteria line', () => {
  it('reads as distance, recency and size tolerance', () => {
    expect(criteriaSummary({ radiusMiles: 0.5, months: 12, livingAreaPct: 20 }))
      .toBe('0.5 mi · 12 mo · ±20% size');
  });

  it('says "any" rather than a number when a filter was not applied', () => {
    // null is "do not filter on this", and 0 would be the opposite claim.
    expect(criteriaSummary({ radiusMiles: null, months: null, livingAreaPct: null }))
      .toBe('any distance · any date');
  });

  it('describes the defaults a fresh profile is created with', () => {
    expect(criteriaSummary(DEFAULT_CRITERIA)).toBe('1 mi · 12 mo · ±30% size');
  });
});

describe('the subject line', () => {
  it('splits the street from the rest, as the list prints them', () => {
    expect(profileListSubject({ street: '1358 5th St', city: 'La Verne', state: 'CA', zip: '91750' }))
      .toEqual({ listSubject: '1358 5th St', listSubjectDetail: 'La Verne, CA 91750' });
  });

  it('trims what the operator typed instead of storing their spacing', () => {
    expect(profileListSubject({ street: ' 1358 5th St ', city: ' La Verne ', state: ' CA ', zip: ' 91750 ' }).listSubjectDetail)
      .toBe('La Verne, CA 91750');
  });
});

describe('who writes these columns', () => {
  // generate.ts and render.ts both talk to the database and the vendor, so
  // there is no unit test that can watch them write. The columns are read by
  // the Reports list, and a blank Subject on a real row is the failure this
  // guards: asserted on the source, comments stripped.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const strip = (f: string) => readFileSync(join(HERE, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('is stamped on the row when the profile is created, before the vendor answers', () => {
    const src = strip('generate.ts');
    expect(src).toContain('...profileListSubject(input)');
    expect(src).toContain('listSettings: criteriaSummary(DEFAULT_CRITERIA)');
  });

  it('is rewritten by every render, with the criteria actually applied', () => {
    // Stored does not mean written once. A profile re-filtered to half a mile
    // must not go on advertising the mile it was created with.
    expect(strip('render.ts')).toContain('listSettings: criteriaSummary(applied)');
  });
});
