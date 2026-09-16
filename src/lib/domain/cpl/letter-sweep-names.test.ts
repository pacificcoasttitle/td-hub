import { describe, expect, it } from 'vitest';
import { buildOrderBodyForTest } from '@/lib/integrations/cpl/westcor/payloads';
import {
  classifyPartyName,
  isJunkNameFragment,
  resolveBorrowers,
} from './borrower-resolution';

/**
 * The five strings the letter sweep found on issued CPLs. They are the
 * specification. Invented vestings do not count.
 *
 *   Giahuy H Tr G H Nguyen   20019876-OCT / 20019877-OCT
 *                            source: NGUYEN, GIAHUY H TR G H
 *   Living Tr Nguyen         same files, source: NGUYEN LIVING TR
 *   Tenants                  last-space split of "… as joint tenants"
 *   2016                     comma-split of "… Trust Dated September 01, 2016"
 *   KOGAN                    20020493-GLT source KOGAN JACOB & ELENA
 *                            (and 20019177-GLT seller KOGAN, YURIY)
 */

function placed(name: string) {
  const fields = buildOrderBodyForTest([name]);
  return {
    kind: classifyPartyName(name),
    junk: isJunkNameFragment(name),
    First: String(fields.First ?? ''),
    Last: String(fields.Last ?? ''),
    Trust: String(fields.Trust ?? ''),
    CompanyName: String(fields.CompanyName ?? ''),
  };
}

describe('letter-sweep names — the function is the whole risk', () => {
  it('Giahuy H Tr G H Nguyen is a trust, not a person named Giahuy', () => {
    const r = placed('Giahuy H Tr G H Nguyen');
    expect(r.kind).toBe('trust');
    expect(r.Last).toBe('');
    expect(r.First).toBe('');
    expect(r.Trust).toBe('Giahuy H Tr G H Nguyen');
    expect(r.CompanyName).toBe('Giahuy H Tr G H Nguyen');
  });

  it('Tenants is not a borrower', () => {
    const r = placed('Tenants');
    expect(r.junk).toBe(true);
    expect(r.Last).not.toMatch(/tenants/i);
    expect(r.Last).toBe('');
    expect(r.Trust).toBe('');
  });

  it('2016 is not a borrower', () => {
    const r = placed('2016');
    expect(r.junk).toBe(true);
    expect(r.Last).toBe('');
    expect(r.First).not.toBe('2016');
    expect(r.Trust).toBe('');
  });

  it('KOGAN is not the whole borrower — the source is two people', () => {
    const r = resolveBorrowers({
      buyerParties: [],
      primaryOwner: 'KOGAN JACOB & ELENA',
      transactionType: 'Refinance',
    });
    expect(r.names.join(' ')).not.toBe('KOGAN');
    expect(r.names.some((n) => /kogan/i.test(n) && /jacob/i.test(n))).toBe(true);
    expect(r.names.some((n) => /elena/i.test(n))).toBe(true);
    const lone = placed('KOGAN');
    expect(lone.kind).toBe('person');
    expect(lone.Trust).toBe('');
  });

  it('Living Tr Nguyen is a trust, not Living + Last Nguyen', () => {
    const r = placed('Living Tr Nguyen');
    expect(r.kind).toBe('trust');
    expect(r.Last).toBe('');
    expect(r.First).toBe('');
    expect(r.Trust).toBe('Living Tr Nguyen');
  });
});

describe('the SiteX rows that produced those letters', () => {
  it('NGUYEN, GIAHUY H TR G H goes to the trust field', () => {
    const r = placed('NGUYEN, GIAHUY H TR G H');
    expect(r.kind).toBe('trust');
    expect(r.Last).toBe('');
    expect(r.Trust).toBe('NGUYEN, GIAHUY H TR G H');
  });

  it('NGUYEN LIVING TR goes to the trust field', () => {
    const r = placed('NGUYEN LIVING TR');
    expect(r.kind).toBe('trust');
    expect(r.Trust).toBe('NGUYEN LIVING TR');
  });

  it('a TRUSTEE in parentheses is still a person', () => {
    expect(classifyPartyName('DANNA MICHAEL A (TRUSTEE)')).toBe('person');
    expect(placed('DANNA MICHAEL A (TRUSTEE)').Last).toBe('(TRUSTEE)');
  });
});
