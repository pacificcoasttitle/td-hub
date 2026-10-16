import { describe, expect, it } from 'vitest';
import { classifyNonOkBody } from './client';
import { readSource } from '@/test-support/read-source';

// Payload shapes below are taken verbatim from production vendor_api_logs.

const NOT_FOUND_BODY = JSON.stringify({
  ERROR_MESSAGES: [
    {
      ErrorMessageCategoryCode: 'NotFound',
      ErrorMessageCode: 'SXP-NotFound-001',
      ErrorMessage: 'No property found for the given address.',
    },
  ],
});

const MULTI_MATCH_BODY = JSON.stringify({
  Locations: [
    { FIPS: '06059', APN: '933-270-01', Address: '2501 S EL CAMINO REAL', City: 'SAN CLEMENTE', State: 'CA', Zip: '92672' },
    { FIPS: '06059', APN: '933-270-02', Address: '2501 S EL CAMINO REAL', City: 'SAN CLEMENTE', State: 'CA', Zip: '92672' },
  ],
});

describe('classifyNonOkBody', () => {
  it('treats a 404 SXP-NotFound as a no-match, not an error', () => {
    expect(classifyNonOkBody(404, NOT_FOUND_BODY)).toEqual({ kind: 'no_match' });
  });

  it('recognises NotFound by category code alone', () => {
    const body = JSON.stringify({ ERROR_MESSAGES: [{ ErrorMessageCategoryCode: 'NotFound' }] });
    expect(classifyNonOkBody(404, body)).toEqual({ kind: 'no_match' });
  });

  it('recognises NotFound by the SXP- error code alone', () => {
    const body = JSON.stringify({ ERROR_MESSAGES: [{ ErrorMessageCode: 'SXP-NotFound-002' }] });
    expect(classifyNonOkBody(404, body)).toEqual({ kind: 'no_match' });
  });

  it('parses a 300 into a multi-match carrying the candidates', () => {
    const out = classifyNonOkBody(300, MULTI_MATCH_BODY);
    expect(out.kind).toBe('multi_match');
    if (out.kind !== 'multi_match') throw new Error('expected multi_match');
    expect(out.raw.Locations).toHaveLength(2);
    expect(out.raw.Locations![0].APN).toBe('933-270-01');
    expect(out.raw.Locations![0].FIPS).toBe('06059');
  });

  // ── Everything below must still be a genuine failure ──────────────────────

  it('keeps 5xx as an error', () => {
    expect(classifyNonOkBody(500, '{"message":"boom"}')).toEqual({ kind: 'error', body: '{"message":"boom"}' });
    expect(classifyNonOkBody(503, '{}').kind).toBe('error');
  });

  it('keeps auth failures as errors', () => {
    expect(classifyNonOkBody(401, '{"message":"unauthorized"}').kind).toBe('error');
    expect(classifyNonOkBody(403, '{}').kind).toBe('error');
  });

  it('keeps a 404 that is NOT a SiteX not-found as an error', () => {
    // e.g. a wrong URL — HTML or an unrelated JSON shape
    expect(classifyNonOkBody(404, '{"message":"Cannot GET /wrong/path"}').kind).toBe('error');
    expect(classifyNonOkBody(404, '<html>404</html>').kind).toBe('error');
  });

  it('keeps a 300 with no candidates as an error', () => {
    expect(classifyNonOkBody(300, '{"Locations":[]}').kind).toBe('error');
    expect(classifyNonOkBody(300, '{}').kind).toBe('error');
  });

  it('keeps an unparseable body as an error', () => {
    expect(classifyNonOkBody(404, '').kind).toBe('error');
    expect(classifyNonOkBody(500, 'gateway timeout').kind).toBe('error');
  });

  it('does not mistake a NotFound payload on a 500 for a no-match', () => {
    // Status is part of the decision — a server error stays an error.
    expect(classifyNonOkBody(500, NOT_FOUND_BODY).kind).toBe('error');
  });
});

// ─── A charged search has to be reconcilable ────────────────────────────────
//
// property_search logged { match, locationCount } on a 200 — no SearchId, no
// credit, no feed id. So a charged address search left no handle that joins to
// an invoice line and no record of which feed it was billed under. The
// concierge logger has recorded all three since it shipped; these two readings
// of the same response had drifted apart.

describe('the property_search log says what a search cost', () => {
  const src = readSource('src/lib/integrations/sitex/client.ts', {
    mustContain: "operation: 'property_search'",
  });

  it('records SearchId on the charged path', () => {
    // The ONLY handle that reconciles against an invoice line.
    expect(src).toContain('searchId: raw.OrderInfo?.SearchId');
  });

  it('records the credit on every outcome, not only the charged one', () => {
    // "What did this cost" must not need a reader who already knows the rule.
    // A 2xx charges one and a non-2xx charges nothing — measured on UAT.
    const charged = (src.match(/creditsCharged: 1/g) ?? []).length;
    const free = (src.match(/creditsCharged: 0/g) ?? []).length;
    expect(charged, 'the 200 path must say it charged').toBeGreaterThanOrEqual(1);
    expect(free, 'no_match and multi_match must say they did not').toBeGreaterThanOrEqual(2);
  });

  it('records WHICH FEED it was billed under', () => {
    // Concierge and the order flow are both 100001 today and are separate
    // variables on purpose. A charge logged without its feed cannot be
    // attributed if that ever stops being true.
    expect(src).toMatch(/requestMeta: \{ addr: params\.street, lastLine, feedId: config\.feedId \}/);
  });
});
