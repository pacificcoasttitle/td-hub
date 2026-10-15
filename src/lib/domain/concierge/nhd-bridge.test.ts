import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSource } from '@/test-support/read-source';

// ─── A deploy that cannot call MyNHD has not failed at calling MyNHD ────────
//
// Until MyNHD issues a production key, every production deploy is a deploy
// without one. Before this guard, a click there took the claim, set
// hazard_requested true and hazard_status 'pending', then wrote 'failed' with
// "MyNHD is not configured" into hazard_error — so a configuration gap left a
// PERMANENT FAILED MARK on a client's profile, and the row action then offered
// "Retry hazard preview — last attempt: MyNHD is not configured", a retry of
// nothing.
//
// These assert the refusal happens before any write and before any claim. The
// database and the vendor are both mocked: the point is WHAT IS CALLED, and
// nothing here should call either.

const updates: unknown[] = [];
const claims: string[] = [];

vi.mock('@/lib/db/client', () => {
  const chain = {
    set: (v: unknown) => { updates.push(v); return chain; },
    where: () => chain,
    from: () => chain,
    limit: async () => [PROFILE],
  };
  return {
    db: {
      select: () => chain,
      update: () => chain,
    },
  };
});

vi.mock('./claim', () => ({
  claimProperty: async (k: string) => { claims.push(k); return { held: true }; },
  releaseClaim: async () => {},
  propertyRequestKey: () => 'key',
  scopedClaimKey: (k: string, s: string) => `${k}|${s}`,
}));

type Refusal = { ok: false; reason: string; message: string; evidence: null; durationMs: number };
let vendorAnswer: Refusal = { ok: false, reason: 'api_error', message: 'x', evidence: null, durationMs: 1 };
const fetchPreview = vi.fn(async () => vendorAnswer);
vi.mock('@/lib/integrations/mynhd/client', () => ({ fetchFloodFirePreview: fetchPreview }));
vi.mock('./render', () => ({ renderProfile: async () => ({ ok: true, message: 'ok' }) }));
vi.mock('@/lib/integrations/s3/client', () => ({ uploadFile: async () => ({ success: true }) }));

/** A profile that is otherwise perfectly askable: payload, APN and FIPS. */
const PROFILE = {
  id: 12,
  rawStorageKey: 'concierge/12/sitex-raw.json',
  hazardStatus: null,
  hazardStorageKey: null,
  subjectApn: '936-640-31',
  subjectFips: '06059',
  propertyKey: 'key',
  requestedAddress: '4572 W 5th St',
  requestedCity: 'Santa Ana',
  requestedState: 'CA',
  requestedZip: '92703',
};

const { requestHazardPreview } = await import('./nhd-bridge');

const ENV = ['MYNHD_SECRET_KEY', 'MYNHD_BASE_URL', 'VERCEL_ENV'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  updates.length = 0;
  claims.length = 0;
  fetchPreview.mockClear();
  vendorAnswer = { ok: false, reason: 'api_error', message: 'x', evidence: null, durationMs: 1 };
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('an unconfigured deploy refuses without touching the profile', () => {
  it('refuses, rather than failing', async () => {
    const r = await requestHazardPreview(12);
    expect(r.ok).toBe(false);
    // 'refused', NOT 'failed'. The difference is whether the row keeps a mark.
    expect(r.status).toBe('refused');
    expect(r.charges).toBe(0);
  });

  it('writes NOTHING to the row', async () => {
    // The defect this exists for: hazard_requested true and hazard_status
    // 'failed' written onto a client's profile because of a missing env var.
    await requestHazardPreview(12);
    expect(updates).toEqual([]);
  });

  it('takes no claim, so a later real attempt is not locked out', async () => {
    await requestHazardPreview(12);
    expect(claims).toEqual([]);
  });

  it('does not reach the vendor', async () => {
    await requestHazardPreview(12);
    expect(fetchPreview).not.toHaveBeenCalled();
  });

  it('says which problem it is', async () => {
    const r = await requestHazardPreview(12);
    expect(r.message).toContain('MYNHD_SECRET_KEY');
  });
});

describe('a crossed environment refuses the same way', () => {
  it('names the crossing rather than a missing key', async () => {
    // A key IS set here. Saying "not configured" would send somebody looking
    // for the wrong thing.
    process.env.MYNHD_SECRET_KEY = 'dev-key';
    process.env.MYNHD_BASE_URL = 'https://dev-api.mynhd.test';
    process.env.VERCEL_ENV = 'production';

    const r = await requestHazardPreview(12);
    expect(r.status).toBe('refused');
    expect(r.message).toContain('must not be crossable');
    expect(updates).toEqual([]);
    expect(claims).toEqual([]);
    expect(fetchPreview).not.toHaveBeenCalled();
  });
});

describe('a configured deploy does proceed', () => {
  it('claims on the nhd scope and calls the vendor', async () => {
    // Non-vacuity: if the refusal above fired unconditionally, every assertion
    // in this file would pass for the wrong reason.
    process.env.MYNHD_SECRET_KEY = 'k';
    await requestHazardPreview(12);
    expect(claims).toEqual(['key|nhd']);
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    // And it does write, which is what makes "writes NOTHING" above mean
    // something.
    expect(updates.length).toBeGreaterThan(0);
  });
});

describe('the refusal comes before the claim, in the source', () => {
  it('is ordered so, not merely tested so', async () => {
    // The order IS the property. A config check after claimProperty would pass
    // every assertion above that looks at the vendor, and still leave a claim
    // behind on an unconfigured deploy.
    const src = readSource('src/lib/domain/concierge/nhd-bridge.ts', {
      mustContain: ['readConfig()', 'claimProperty('],
    });
    expect(src.indexOf('readConfig()')).toBeLessThan(src.indexOf('claimProperty('));
  });
});

// ─── A wrong key is the same defect as a missing one ────────────────────────
//
// The early readConfig() refusal stops a MISSING key from marking a row. It
// cannot stop a WRONG one: a key is an opaque string, so a dev key on the
// production target reads as valid configuration and is refused by MyNHD
// rather than by us. That was the live state on the production deploy the day
// this shipped — health said configured:true, productionHost:true, ok:true,
// and a click would have come back 401.
//
// An account or environment problem is identical for every profile in the
// table. Marking the one row somebody clicked says the parcel is at fault,
// offers a retry that cannot succeed until a config change, and stains a dozen
// rows before anybody notices.

describe('an account or environment refusal does not mark the row', () => {
  const vendorRefuses = async (reason: string, message = 'vendor said no') => {
    process.env.MYNHD_SECRET_KEY = 'k';
    vendorAnswer = { ok: false, reason, message, evidence: null, durationMs: 5 };
    return requestHazardPreview(12);
  };

  /**
   * The row's END STATE, not the number of writes.
   *
   * There are two: 'pending' goes down before the call so that a crash
   * mid-flight leaves a trace, and it is cleared again on an account refusal.
   * Asserting "no writes" would have been asserting the implementation, and
   * it is how the first version of these tests failed — correctly, because the
   * pre-call write was still leaving the row at 'pending', which the control
   * reads as "did not finish — try again". The defect in a different costume.
   */
  const endState = () => Object.assign({}, ...updates as Record<string, unknown>[]);

  it('a 401 leaves the row untouched, not failed and not pending', async () => {
    // The live case: a dev key reaching MyNHD's production host.
    const r = await vendorRefuses('auth_failed', 'MyNHD would not accept our credentials.');
    expect(r.status).toBe('refused');
    expect(endState()).toMatchObject({
      hazardRequested: false, hazardStatus: null, hazardError: null,
    });
    expect(JSON.stringify(updates)).not.toContain('failed');
  });

  it('a 403 — no preview entitlement — is a refusal too', async () => {
    const r = await vendorRefuses('no_permission');
    expect(r.status).toBe('refused');
    expect(endState()).toMatchObject({ hazardStatus: null });
  });

  it('an unreachable vendor is a refusal, not a mark on one parcel', async () => {
    const r = await vendorRefuses('network');
    expect(r.status).toBe('refused');
    expect(endState()).toMatchObject({ hazardStatus: null });
  });

  it('does not keep the vendor account fields describing OUR configuration', async () => {
    // hazard_success / code / http_status describe our credentials, not this
    // property. The vendor log has them with the host and target beside them,
    // which is where that belongs.
    await vendorRefuses('auth_failed');
    expect(endState()).toMatchObject({
      hazardSuccess: null, hazardCode: null, hazardHttpStatus: null,
    });
  });

  it('but the vendor WAS asked, so the claim was taken and given back', async () => {
    // Non-vacuity, and the difference from the early refusals: this one gets
    // all the way to MyNHD and comes back. If it short-circuited earlier these
    // assertions would pass for the wrong reason.
    await vendorRefuses('auth_failed');
    expect(claims).toEqual(['key|nhd']);
    expect(fetchPreview).toHaveBeenCalledTimes(1);
  });
});

describe('a refusal about the parcel DOES mark the row', () => {
  const vendorRefuses = async (reason: string) => {
    process.env.MYNHD_SECRET_KEY = 'k';
    vendorAnswer = { ok: false, reason, message: 'about this parcel', evidence: null, durationMs: 5 };
    return requestHazardPreview(12);
  };

  it('multi_result is recorded — it should not happen on an APN search', async () => {
    const r = await vendorRefuses('multi_result');
    expect(r.status).toBe('failed');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('no_document is recorded', async () => {
    expect((await vendorRefuses('no_document')).status).toBe('failed');
  });

  it('api_error is recorded, with the words the vendor used', async () => {
    const r = await vendorRefuses('api_error');
    expect(r.status).toBe('failed');
    expect(JSON.stringify(updates)).toContain('about this parcel');
  });
});
