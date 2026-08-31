import { describe, expect, it } from 'vitest';
import { formatAgentPhone } from './soap';

// The mask FNF asks for: (999) 999-9999.
// The inputs are the real shapes in cpl_branches — 0 of 13 FNF rows were
// already in the mask when this was written.

describe('the shapes actually stored in cpl_branches', () => {
  it.each([
    ['925.942.4040', '(925) 942-4040'],
    ['818.662-6700', '(818) 662-6700'],
    ['714.516.6700', '(714) 516-6700'],
    ['805.604.4696', '(805) 604-4696'],
  ])('%s -> %s', (raw, want) => expect(formatAgentPhone(raw)).toBe(want));
});

describe('other plausible inputs', () => {
  it.each([
    ['7145166700', '(714) 516-6700'],
    ['(714) 516-6700', '(714) 516-6700'],
    ['714-516-6700', '(714) 516-6700'],
    ['+1 714 516 6700', '(714) 516-6700'],
    ['1-714-516-6700', '(714) 516-6700'],
  ])('%s -> %s', (raw, want) => expect(formatAgentPhone(raw)).toBe(want));
});

describe('it passes through rather than mangling', () => {
  it('an extension is not a phone number we can mask', () => {
    // 13 digits. Guessing which three are the area code would put a
    // wrong-but-plausible number on a legal instrument.
    expect(formatAgentPhone('714-516-6700 x212')).toBe('714-516-6700 x212');
  });

  it.each([
    ['12345', '12345'],
    ['see website', 'see website'],
    ['011 44 20 7946 0000', '011 44 20 7946 0000'],
  ])('%s is left alone', (raw, want) => expect(formatAgentPhone(raw)).toBe(want));

  it('empty stays empty, and never becomes a malformed mask', () => {
    expect(formatAgentPhone('')).toBe('');
    expect(formatAgentPhone(null)).toBe('');
    expect(formatAgentPhone(undefined)).toBe('');
    expect(formatAgentPhone('   ')).toBe('');
  });

  it('an 11-digit number NOT starting with 1 is not truncated', () => {
    expect(formatAgentPhone('27145166700')).toBe('27145166700');
  });
});
