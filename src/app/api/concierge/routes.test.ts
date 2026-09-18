import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

// One route may spend. Four may not. That split is the whole safety model, so
// it is asserted against the source rather than trusted to review.
describe('exactly one route can spend a credit', () => {
  const generate = read('profiles/route.ts');
  const free = [
    'profiles/[id]/criteria/route.ts', 'profiles/[id]/render/route.ts',
    'profiles/[id]/pdf/route.ts', 'profiles/[id]/resume/route.ts',
  ];

  it('only the generate route imports the generator', () => {
    expect(generate).toContain('generateConciergeProfile');
    for (const f of free) {
      expect(read(f), f).not.toContain('generateConciergeProfile');
      expect(read(f), f).not.toMatch(/integrations\/sitex/);
    }
  });

  it('the generate route checks BOTH conditions before anything else', () => {
    expect(generate).toContain('denyConciergeGeneration(session.role)');
    // The gate must precede the body parse, so a disabled feature never reaches
    // validation, let alone the vendor.
    expect(generate.indexOf('denyConciergeGeneration')).toBeLessThan(generate.indexOf('bodySchema.safeParse'));
  });

  it('the free routes are NOT gated on the feature flag', () => {
    // Turning generation off must not strand a profile that already exists.
    for (const f of ['profiles/[id]/criteria/route.ts', 'profiles/[id]/render/route.ts', 'profiles/[id]/resume/route.ts']) {
      expect(read(f), f).not.toContain('denyConciergeGeneration');
      expect(read(f), f).toContain('canGenerateConcierge');
    }
  });

  it('the free routes tell the caller the render was free', () => {
    for (const f of ['profiles/[id]/criteria/route.ts', 'profiles/[id]/render/route.ts']) {
      expect(read(f), f).toContain('creditsCharged: 0');
      expect(read(f), f).toContain('freeRender: true');
    }
  });

  it('resume finishes a paid-for profile but refuses to buy one again', () => {
    // The ingest of profile 3 failed after the credit was spent. Resume exists
    // to finish it from the stored payload — and a profile with no stored
    // payload must be refused, because finishing that one means paying twice.
    const resume = read('profiles/[id]/resume/route.ts');
    expect(resume).toContain('ingestPayload');
    expect(resume).toContain('creditsCharged: 0');
    expect(resume).toContain('rawStorageKey');
    expect(resume).toMatch(/cannot be finished without buying it again/);
  });

  it('the double-charge guard is keyed on the property, not the order', () => {
    // The entry point moved to the Reports page, where a request carries no
    // order — an order-keyed guard would protect nothing there.
    expect(generate).not.toContain('getProfileForOrder');
    const claim = read('../../../lib/domain/concierge/generate.ts');
    expect(claim).toContain('claimProperty(requestKey)');
    const guard = claim.indexOf('claimProperty(');
    const vendor = claim.indexOf('fetchConciergeProfile(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(vendor);
  });

  it('accepts a generation with no order at all', () => {
    expect(generate).toMatch(/orderId:\s*z\.number\(\)\.int\(\)\.positive\(\)\.nullable\(\)\.optional\(\)/);
  });

  it('the PDF route never accepts a storage key from the browser', () => {
    const pdf = read('profiles/[id]/pdf/route.ts');
    expect(pdf).toContain('getProfilePdfKey(id)');
    expect(pdf).not.toMatch(/searchParams\.get\(['"](key|url|storageKey)/);
  });
});
