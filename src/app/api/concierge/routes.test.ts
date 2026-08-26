import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

// One route may spend. Three may not. That split is the whole safety model, so
// it is asserted against the source rather than trusted to review.
describe('exactly one route can spend a credit', () => {
  const generate = read('profiles/route.ts');
  const free = ['profiles/[id]/criteria/route.ts', 'profiles/[id]/render/route.ts', 'profiles/[id]/pdf/route.ts'];

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
    for (const f of ['profiles/[id]/criteria/route.ts', 'profiles/[id]/render/route.ts']) {
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

  it('generating twice for one order is refused, not charged', () => {
    expect(generate).toContain('getProfileForOrder');
    expect(generate).toContain('409');
  });

  it('the PDF route never accepts a storage key from the browser', () => {
    const pdf = read('profiles/[id]/pdf/route.ts');
    expect(pdf).toContain('getProfilePdfKey(id)');
    expect(pdf).not.toMatch(/searchParams\.get\(['"](key|url|storageKey)/);
  });
});
