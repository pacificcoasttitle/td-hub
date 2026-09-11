import { describe, expect, it } from 'vitest';
import { companyLookupBase, isSoftProLookupCollision, personLookupBase, uniquifyLookupCode, ucfirst } from './lookup-code';

describe('lookup-code', () => {
  it('company: Wells Fargo Bank + 123 Main Street → Well123M', () => {
    expect(companyLookupBase('Wells Fargo Bank', '123 Main Street')).toBe('Well123M');
  });

  it('person: John Smith at Wells Fargo Bank → JohSmiWell', () => {
    expect(personLookupBase('John', 'Smith', 'Wells Fargo Bank')).toBe('JohSmiWell');
  });

  it('short names are not padded — Al Li at ABC Title is under 10 chars', () => {
    const code = personLookupBase('Al', 'Li', 'ABC Title');
    expect(code).toBe('AlLiABCT');
    expect(code.length).toBeLessThan(10);
  });

  it('ucfirst leaves the rest of the slice unchanged', () => {
    expect(ucfirst('wells')).toBe('Wells');
    expect(ucfirst('123M')).toBe('123M');
  });

  it('collision appends 1 then 2', () => {
    // The digit lives INSIDE ten, not past it. 'JohSmiWell' is already 10, so
    // the suffix replaces its last character rather than extending it.
    expect(uniquifyLookupCode('JohSmiWell', ['JohSmiWell'])).toBe('JohSmiWel1');
    expect(uniquifyLookupCode('JohSmiWell', ['JohSmiWell', 'JohSmiWel1'])).toBe('JohSmiWel2');
  });

  it('never returns a code SoftPro will reject for length', () => {
    // SoftPro's order endpoint: 400 "Value must be no longer than 10
    // characters." Its contact endpoint accepts the same string, so an
    // over-length code fails on the first ORDER, not at creation.
    const taken: string[] = ['JohSmiWell'];
    for (let i = 0; i < 40; i += 1) {
      const code = uniquifyLookupCode('JohSmiWell', taken);
      expect(code.length, code).toBeLessThanOrEqual(10);
      taken.push(code);
    }
  });

  it('a trimmed candidate that is already taken is skipped, not returned', () => {
    // Measured on the 154 existing over-length codes: six would land on a code
    // another contact already holds if we trimmed blindly.
    expect(uniquifyLookupCode('JohSmiWell', ['JohSmiWell', 'JohSmiWel1', 'JohSmiWel2']))
      .toBe('JohSmiWel3');
  });

  it('a short base still just appends', () => {
    expect(uniquifyLookupCode('Abc', ['Abc'])).toBe('Abc1');
  });

  it('a base longer than ten is capped before anything else', () => {
    expect(uniquifyLookupCode('JuaLesKell1', [])).toBe('JuaLesKell');
  });

  it('collision check is case-insensitive', () => {
    expect(uniquifyLookupCode('Well123M', ['well123m'])).toBe('Well123M1');
  });
});

describe('isSoftProLookupCollision', () => {
  it('matches vendor duplicate wording', () => {
    expect(isSoftProLookupCollision('LookupCode already exists')).toBe(true);
    expect(isSoftProLookupCollision('Duplicate ClientLookupCode')).toBe(true);
    expect(isSoftProLookupCollision(
      "Cannot insert duplicate key row in object 'dbo.lkup_X' with unique index 'IX_lkup_X_KEY'. The duplicate key value is (PctHhxqq).",
    )).toBe(true);
    expect(isSoftProLookupCollision('Validation failed')).toBe(false);
  });
});
