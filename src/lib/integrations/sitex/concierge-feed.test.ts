import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSource } from '@/test-support/read-source';

// logRequest writes to vendor_api_logs. These tests are about the classifier,
// and must not need a database to decide what a status code means. Hoisted,
// because vi.mock is — putting it in beforeEach registers nothing.
vi.mock('./auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('./auth')>();
  return { ...real, logRequest: vi.fn(async () => {}) };
});

import {
  ambiguousMessage, evaluateGuard, fetchConciergeProfile, guardMessage,
} from './concierge-feed';

// ─── A multi-match is an answer, not an error ───────────────────────────────
//
// SiteX replies to "4572 West 5th Street, Santa Ana" with HTTP 300 and a
// candidate per condominium unit. The feed client called every non-2xx
// `api_error` and put the status code on screen, so the operator was shown
// "SiteX returned HTTP 300" and had nothing to act on: the same address was
// attempted 14 times in 53 minutes on 2026-10-08, charging nothing each time.
//
// THE BODY HERE IS THE REAL ONE, from vendor_api_logs. Its one Location is
// verbatim; the logged body is truncated at 400 characters, so the true
// candidate count is not recoverable and is NOT asserted. See
// fixtures/README.md.

const SANTA_ANA_300 = readSource(
  'src/lib/integrations/sitex/fixtures/multi-match-300-santa-ana.json',
  // The parcel this whole fix is about. If the fixture is edited to something
  // else, these assertions stop being about the reported bug.
  { mustContain: ['"APN": "936-640-31"', '"FIPS": "06059"'] },
);

const NOT_FOUND_404 = JSON.stringify({
  ERROR_MESSAGES: [{ ErrorMessageCategoryCode: 'NotFound', ErrorMessageCode: 'SXP-NotFound-001' }],
});

/** A 200 whose feed is populated and whose single Location passes the guard. */
const SINGLE_200 = JSON.stringify({
  Locations: [{ FIPS: '06059', APN: '936-640-31', Address: '4572 W 5TH ST' }],
  Feed: { PropertyProfile: { PrimaryOwnerName: 'DIAZ, OMAR' } },
  OrderInfo: { IsValidAddress: true, OutsideCoverage: false, SearchId: 1421335387 },
});

const PARAMS = { street: '4572 West 5th Street', city: 'Santa Ana', state: 'CA', zip: '92703-3162' };

/** The URL the last fetch was given. */
let lastUrl = '';

function answer(status: number, body: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    // The token call comes first and is not the one under test.
    if (String(url).includes('/ls/apigwy/oauth2/v1/token') || String(url).includes('oauth')) {
      return new Response(JSON.stringify({ access_token: 't', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
    }
    lastUrl = String(url);
    return new Response(body, { status });
  }));
}

beforeEach(() => {
  lastUrl = '';
  process.env.SITEX_BASE_URL = 'https://sitex.example.test';
  process.env.SITEX_CLIENT_ID = 'id';
  process.env.SITEX_CLIENT_SECRET = 'secret';
  process.env.SITEX_CONCIERGE_FEED_ID = '100001';
  process.env.SITEX_FEED_ID = '100001';
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('HTTP 300 is a question, not a failure', () => {
  it('comes back as ambiguous_match with the candidates attached', async () => {
    answer(300, SANTA_ANA_300);
    const r = await fetchConciergeProfile(PARAMS);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('ambiguous_match');
    // The answer has to travel with the refusal, or the refusal is unanswerable.
    expect(r.candidates).toBeDefined();
    expect(r.candidates!.length).toBeGreaterThan(0);
    expect(r.candidates![0]).toMatchObject({
      apn: '936-640-31', fips: '06059', unitType: '#', unitNumber: '31',
      owner: 'DIAZ, OMAR',
    });
  });

  it('charges nothing, and says so', async () => {
    answer(300, SANTA_ANA_300);
    const r = await fetchConciergeProfile(PARAMS);
    expect(r.creditsCharged).toBe(0);
    expect(r.ok ? '' : r.message).toContain('nothing has been charged');
  });

  it('does not put the status code on screen', async () => {
    // What the operator saw 14 times. A status code is not an instruction.
    answer(300, SANTA_ANA_300);
    const r = await fetchConciergeProfile(PARAMS);
    expect(r.ok ? '' : r.message).not.toContain('300');
    expect(r.ok ? '' : r.message).not.toMatch(/HTTP/i);
  });

  it('reports the count SiteX actually sent, not a fixed phrase', async () => {
    answer(300, JSON.stringify({
      Locations: [
        { APN: 'a', FIPS: '06059', Address: 'X' },
        { APN: 'b', FIPS: '06059', Address: 'X' },
        { APN: 'c', FIPS: '06059', Address: 'X' },
      ],
    }));
    const r = await fetchConciergeProfile(PARAMS);
    expect(r.ok ? '' : r.message).toContain('3 properties');
    expect(r.ok ? null : r.guard?.locationCount).toBe(3);
  });

  it('a 300 carrying no Locations stays an error — there is nothing to pick', async () => {
    answer(300, JSON.stringify({ Locations: [] }));
    const r = await fetchConciergeProfile(PARAMS);
    expect(r.ok ? '' : r.reason).toBe('api_error');
  });
});

describe('HTTP 404 NotFound is no_match, not an API error', () => {
  it('says no property matched', async () => {
    answer(404, NOT_FOUND_404);
    const r = await fetchConciergeProfile(PARAMS);
    expect(r.ok ? '' : r.reason).toBe('no_match');
    expect(r.ok ? '' : r.message).toBe(guardMessage('no_match'));
  });

  it('an unexpected 404 shape is still an error', async () => {
    answer(404, JSON.stringify({ something: 'else' }));
    const r = await fetchConciergeProfile(PARAMS);
    expect(r.ok ? '' : r.reason).toBe('api_error');
  });
});

describe('a 5xx is still an error', () => {
  it('reports the status, because there is nothing else to say', async () => {
    answer(503, 'upstream down');
    const r = await fetchConciergeProfile(PARAMS);
    expect(r.ok ? '' : r.reason).toBe('api_error');
    expect(r.ok ? '' : r.message).toContain('503');
  });
});

describe('searching by the parcel the operator picked', () => {
  it('sends apn and fips, and NOT the address', async () => {
    // Re-sending the address is asking SiteX the same ambiguous question it
    // just declined to answer.
    answer(200, SINGLE_200);
    await fetchConciergeProfile({ ...PARAMS, apn: '936-640-31', fips: '06059' });
    const u = new URL(lastUrl);
    expect(u.searchParams.get('apn')).toBe('936-640-31');
    expect(u.searchParams.get('fips')).toBe('06059');
    expect(u.searchParams.get('addr')).toBeNull();
    expect(u.searchParams.get('lastLine')).toBeNull();
  });

  it('sends the address when there is no parcel', async () => {
    answer(200, SINGLE_200);
    await fetchConciergeProfile(PARAMS);
    const u = new URL(lastUrl);
    expect(u.searchParams.get('addr')).toBe('4572 West 5th Street');
    expect(u.searchParams.get('lastLine')).toBe('Santa Ana, CA, 92703');
    expect(u.searchParams.get('apn')).toBeNull();
  });

  it('will not send an apn without a fips', async () => {
    // The request shape that failed all 13 times in the orders flow. Sending it
    // spends a round trip to be told "Missing required fields".
    answer(200, SINGLE_200);
    await fetchConciergeProfile({ ...PARAMS, apn: '936-640-31', fips: null });
    const u = new URL(lastUrl);
    expect(u.searchParams.get('apn')).toBeNull();
    expect(u.searchParams.get('addr')).toBe('4572 West 5th Street');
  });

  it('treats blank strings as absent, not as a parcel', async () => {
    answer(200, SINGLE_200);
    await fetchConciergeProfile({ ...PARAMS, apn: '  ', fips: '  ' });
    expect(new URL(lastUrl).searchParams.get('addr')).toBe('4572 West 5th Street');
  });

  it('still truncates the zip to five, parcel or not', async () => {
    answer(200, SINGLE_200);
    await fetchConciergeProfile(PARAMS);
    expect(new URL(lastUrl).searchParams.get('lastLine')).not.toContain('3162');
  });
});

describe('the classifier is imported, not restated', () => {
  it('reads 300 and 404 through client.ts rather than deciding again', () => {
    // One classifier, not two. This file spent its whole life calling both of
    // SiteX's ordinary non-2xx answers `api_error` while client.ts had been
    // handling them correctly; a third reading of a status code is how they
    // drift apart.
    // readSource strips comments already, and refuses if the anchor is gone.
    const src = readSource('src/lib/integrations/sitex/concierge-feed.ts', {
      mustContain: 'export async function fetchConciergeProfile',
    });
    expect(src).toContain('classifyNonOkBody');
    // No local re-derivation of the meaning of those codes.
    expect(src).not.toMatch(/status\s*===\s*300/);
    expect(src).not.toMatch(/status\s*===\s*404/);
    expect(src).not.toContain('ErrorMessageCategoryCode');
  });
});

describe('the wording', () => {
  it('names the count when there is one', () => {
    expect(ambiguousMessage(4)).toContain('4 properties');
  });

  it('falls back to "more than one" rather than "0 properties"', () => {
    expect(ambiguousMessage(0)).toContain('more than one property');
    expect(ambiguousMessage(0)).not.toContain('0 properties');
  });

  it('tells the operator what to do, and that no money moved', () => {
    // The old wording said "Resolve it before generating a profile" — an
    // instruction with no way to carry it out, on a path that never reached it.
    const m = ambiguousMessage(2);
    expect(m).toContain('Pick the one you want');
    expect(m).toContain('nothing has been charged');
  });
});

// ─── 25651 Paseo La Cresta, Laguna Niguel ───────────────────────────────────
//
// A rep reported the condo unit picker not appearing. It appeared, and the rep
// used it. The PICK then failed, and had failed every time since the picker
// shipped in #216 — charging a credit on each attempt.
//
// SiteX answered the parcel search with 65,265 bytes of real property data,
// locationCount 1, outsideCoverage false, matchMethodCode "FA" — and
// IsValidAddress FALSE, because a parcel search sends no address for it to
// validate. evaluateGuard read that as "SiteX did not recognise this address".

describe('IsValidAddress is about an address, and a parcel search has none', () => {
  const parcelAnswer = {
    isValidAddress: false,
    outsideCoverage: false,
    locationCount: 1,
    matchMethodCode: 'FA',
    searchId: 1426628348,
  };

  it('does not refuse a parcel search for having no valid address', () => {
    expect(evaluateGuard(parcelAnswer, 'parcel')).toBeNull();
  });

  it('STILL refuses it on an address search, where false means what it says', () => {
    // The guard is not weakened, it is scoped. An address that SiteX does not
    // recognise is still a refusal.
    expect(evaluateGuard(parcelAnswer, 'address')).toBe('invalid_address');
  });

  it('keeps every other rule on a parcel search', () => {
    // Out of coverage, no match and several matches are all still refusals —
    // they are evidence about the PROPERTY, not about an address string.
    expect(evaluateGuard({ ...parcelAnswer, outsideCoverage: true }, 'parcel')).toBe('outside_coverage');
    expect(evaluateGuard({ ...parcelAnswer, locationCount: 0 }, 'parcel')).toBe('no_match');
    expect(evaluateGuard({ ...parcelAnswer, locationCount: 2 }, 'parcel')).toBe('ambiguous_match');
  });

  it('is unchanged for an address search that passes', () => {
    const good = { ...parcelAnswer, isValidAddress: true };
    expect(evaluateGuard(good, 'address')).toBeNull();
  });
});

describe('one candidate is a confirmation, not a choice', () => {
  it('does not say "1 properties"', () => {
    // What the rep was shown. Ungrammatical, and the wrong question: SiteX
    // had found the unit and wanted it confirmed.
    const m = ambiguousMessage(1);
    expect(m).not.toContain('1 properties');
    expect(m).not.toContain('Pick the one');
    expect(m).toContain('found one property');
    expect(m).toContain('confirmed');
  });

  it('still asks which one when there are several', () => {
    expect(ambiguousMessage(3)).toContain('3 properties');
    expect(ambiguousMessage(3)).toContain('Pick the one you want');
  });

  it('says nothing was charged either way', () => {
    for (const n of [1, 2, 5]) expect(ambiguousMessage(n)).toContain('nothing has been charged');
  });
});

describe('a charged refusal keeps what it bought', () => {
  it('carries the body out on a guard failure', async () => {
    // Paseo La Cresta bought 65,265 bytes and the guard discarded all of them,
    // so what SiteX had said could only be inferred from a length in a log.
    // The guard protects the document, not the evidence.
    answer(200, JSON.stringify({
      Locations: [{ FIPS: '06059', APN: '930-371-05', Address: '25651 PASEO LA CRESTA' }],
      Feed: { PropertyProfile: { APN: '930-371-05', PrimaryOwnerName: 'LIPSITZ, DAVID A' } },
      OrderInfo: { IsValidAddress: false, OutsideCoverage: true, SearchId: 1 },
    }));
    const r = await fetchConciergeProfile({ ...PARAMS, apn: '930-371-05', fips: '06059' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('outside_coverage');
    expect(r.raw, 'the bytes were thrown away').toBeDefined();
    expect(r.raw).toContain('LIPSITZ');
  });
});
