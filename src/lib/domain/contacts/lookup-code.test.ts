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
    expect(uniquifyLookupCode('JohSmiWell', ['JohSmiWell'])).toBe('JohSmiWell1');
    expect(uniquifyLookupCode('JohSmiWell', ['JohSmiWell', 'JohSmiWell1'])).toBe('JohSmiWell2');
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
