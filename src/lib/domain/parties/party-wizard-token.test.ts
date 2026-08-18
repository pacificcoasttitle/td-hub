import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPartyWizardUrl,
  getPartyWizardSecret,
  hashTokenSecret,
  matchesStoredHash,
  mintPartyWizardToken,
  PARTY_WIZARD_TTL_DAYS,
  verifyPartyWizardToken,
} from './party-wizard-token';

const SECRET = 'test-party-wizard-secret-value';

describe('party wizard token', () => {
  beforeEach(() => {
    process.env.PARTY_WIZARD_TOKEN_SECRET = SECRET;
    process.env.NEXT_PUBLIC_APP_URL = 'https://hub.pctitle.com';
  });

  afterEach(() => {
    process.env.PARTY_WIZARD_TOKEN_SECRET = SECRET;
  });

  describe('fails closed', () => {
    it('throws when the secret is unset rather than signing with a default', () => {
      delete process.env.PARTY_WIZARD_TOKEN_SECRET;
      expect(() => getPartyWizardSecret()).toThrow(/PARTY_WIZARD_TOKEN_SECRET/);
    });

    it('NEVER falls back to JOB_RUNNER_SECRET (different trust boundary)', () => {
      delete process.env.PARTY_WIZARD_TOKEN_SECRET;
      process.env.JOB_RUNNER_SECRET = 'some-other-secret';
      expect(() => getPartyWizardSecret()).toThrow();
      delete process.env.JOB_RUNNER_SECRET;
    });

    it('reports misconfiguration instead of accepting a token when the secret is unset', () => {
      const { token } = mintPartyWizardToken();
      delete process.env.PARTY_WIZARD_TOKEN_SECRET;
      const result = verifyPartyWizardToken(token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Server misconfigured');
    });
  });

  describe('mint', () => {
    it('round-trips a freshly minted token', () => {
      const minted = mintPartyWizardToken();
      const result = verifyPartyWizardToken(minted.token);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.parsed.tokenId).toBe(minted.tokenId);
    });

    it('stores only a digest — the token never contains the stored hash', () => {
      const minted = mintPartyWizardToken();
      expect(minted.token).not.toContain(minted.tokenHash);
      expect(minted.tokenHash).toHaveLength(64);
    });

    it('the secret half matches the stored digest', () => {
      const minted = mintPartyWizardToken();
      const secretHalf = minted.token.split('.')[1];
      expect(matchesStoredHash(secretHalf, minted.tokenHash)).toBe(true);
    });

    it('a different secret half does not match the digest', () => {
      const minted = mintPartyWizardToken();
      expect(matchesStoredHash('not-the-secret-half', minted.tokenHash)).toBe(false);
    });

    it('defaults to a 60-day expiry', () => {
      const minted = mintPartyWizardToken();
      const days = (minted.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(PARTY_WIZARD_TTL_DAYS).toBe(60);
      expect(days).toBeGreaterThan(59.9);
      expect(days).toBeLessThan(60.1);
    });

    it('mints a distinct token every time', () => {
      const a = mintPartyWizardToken();
      const b = mintPartyWizardToken();
      expect(a.tokenId).not.toBe(b.tokenId);
      expect(a.token).not.toBe(b.token);
    });

    it('carries no contact data — only hex id, secret and signature', () => {
      const minted = mintPartyWizardToken();
      expect(minted.token.split('.')).toHaveLength(3);
      expect(minted.token.split('.')[0]).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('verify rejects', () => {
    it('a tampered signature', () => {
      const minted = mintPartyWizardToken();
      const [id, secret, sig] = minted.token.split('.');
      const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
      expect(verifyPartyWizardToken(`${id}.${secret}.${flipped}`).ok).toBe(false);
    });

    it('a token signed with a different secret', () => {
      const minted = mintPartyWizardToken();
      process.env.PARTY_WIZARD_TOKEN_SECRET = 'a-completely-different-secret';
      expect(verifyPartyWizardToken(minted.token).ok).toBe(false);
    });

    it('a swapped token id, so ids from two links cannot be mixed', () => {
      const a = mintPartyWizardToken();
      const b = mintPartyWizardToken();
      const [, aSecret, aSig] = a.token.split('.');
      expect(verifyPartyWizardToken(`${b.tokenId}.${aSecret}.${aSig}`).ok).toBe(false);
    });

    it.each([
      ['empty', ''],
      ['too short', 'abc'],
      ['two parts', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.secret'],
      ['four parts', 'a.b.c.d'],
      ['non-hex id', `${'z'.repeat(32)}.abcdefghijklmnop.${'a'.repeat(22)}`],
      ['sql-ish', "' OR 1=1--"],
    ])('malformed input: %s', (_label, token) => {
      expect(verifyPartyWizardToken(token).ok).toBe(false);
    });

    it('an absurdly long token without hashing it', () => {
      expect(verifyPartyWizardToken('a'.repeat(5000)).ok).toBe(false);
    });
  });

  describe('url', () => {
    it('places the token in the path, never in a query string', () => {
      const minted = mintPartyWizardToken();
      const url = buildPartyWizardUrl(minted.token);
      expect(url).toBe(`https://hub.pctitle.com/party-wizard/${minted.token}`);
      expect(url).not.toContain('?');
    });
  });

  it('hashTokenSecret is stable and hex', () => {
    expect(hashTokenSecret('abc')).toBe(hashTokenSecret('abc'));
    expect(hashTokenSecret('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
