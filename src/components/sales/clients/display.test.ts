import { describe, expect, it } from 'vitest';
import { displayClientName, looksLikeEmail } from './display';

describe('looksLikeEmail', () => {
  it('recognises addresses', () => {
    expect(looksLikeEmail('jasmine@nationalleadersescrow.com')).toBe(true);
    expect(looksLikeEmail('  a@b.co  ')).toBe(true);
  });

  it('does not mistake ordinary names for addresses', () => {
    for (const v of ['Jane Smith', "O'Brien & Co", 'Smith, Jane', '', null, undefined, 'jane at kw dot com']) {
      expect(looksLikeEmail(v)).toBe(false);
    }
  });
});

describe('displayClientName', () => {
  it('shows a real name unchanged', () => {
    expect(displayClientName('Jane Smith', 'Keller Williams')).toBe('Jane Smith');
  });

  it('prefers the company when the name is just an email', () => {
    expect(displayClientName('jasmine@nationalleadersescrow.com', 'National Leaders Escrow'))
      .toBe('National Leaders Escrow');
  });

  it('falls back to the email when there is no company', () => {
    expect(displayClientName('jasmine@escrow.com', null)).toBe('jasmine@escrow.com');
    expect(displayClientName('jasmine@escrow.com', '   ')).toBe('jasmine@escrow.com');
  });

  it('handles a missing name', () => {
    expect(displayClientName(null, 'Acme Title')).toBe('Acme Title');
    expect(displayClientName('', null)).toBe('Unnamed client');
  });

  it('trims whitespace', () => {
    expect(displayClientName('  Jane Smith  ', null)).toBe('Jane Smith');
  });
});
