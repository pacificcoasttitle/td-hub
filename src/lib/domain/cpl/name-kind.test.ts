import { describe, expect, it } from 'vitest';
import { classifyPartyName } from './borrower-resolution';

// These import the REAL export. An earlier check of this regex was written by
// hand-copying the pattern into a scratch script, which tested a different
// regex than the file contained — the file's `\b` escapes had been corrupted
// into literal backspace bytes by a shell heredoc, and the hand-typed copy
// hid it.

describe('trusts get their own field', () => {
  it.each([
    'WERNER AND DONNA STEFFEN FAMILY TRUST',
    'SMITH FAMILY TRUST',
    'THE JOHNSON LIVING TRUST',
  ])('%s is a trust', (n) => expect(classifyPartyName(n)).toBe('trust'));

  it('a TRUSTEE is a person, not a trust', () => {
    // Measured: of 998 abstentions, 11 matched TRUSTEE alone and all 11 were
    // people. A trustee acts for a trust; they are not one.
    expect(classifyPartyName('DANNA MICHAEL A (TRUSTEE)')).toBe('person');
    expect(classifyPartyName('WOODWARD STEPHANIE O (TRUSTEE)')).toBe('person');
  });

  it('word boundaries — TRUST inside a longer word is not a trust', () => {
    // The bug this pins: without \b these matched, and one of them is a person.
    expect(classifyPartyName('TRUSTWORTHY REALTY')).not.toBe('trust');
    expect(classifyPartyName('TRUSTINGHAM JOHN')).toBe('person');
  });
});

describe('companies go to CompanyName', () => {
  it.each([
    'V M G INVESTMENT LLC',
    'LUCHSHEYE CORP',
    'PACIFIC COAST HOLDINGS LLC',
    'FIRST NATIONAL BANK',
  ])('%s is a company', (n) => expect(classifyPartyName(n)).toBe('company'));
});

describe('people are untouched — the classifier only ADDS a route', () => {
  it.each([
    'SANCHEZ SERGIO T',
    'Monica C Sarmiento',
    'CONNOR JAMES',
    'Kevin Dell',
    'CHRISTENSEN ELWOOD N',
  ])('%s is a person', (n) => expect(classifyPartyName(n)).toBe('person'));

  it('CO inside CONNOR does not make a company', () => {
    expect(classifyPartyName('CONNOR JAMES')).toBe('person');
  });

  it('an empty name is a person, so nothing changes for a blank', () => {
    expect(classifyPartyName('')).toBe('person');
    expect(classifyPartyName('   ')).toBe('person');
  });
});
