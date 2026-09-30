import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/test-support/read-source';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

// ─── TWO routes may spend. The rest may not. ─────────────────────────────────
//
// This described ONE spender until 2026-09-30, and it said so by name. The tax
// bridge adds a second, so the rule is being CHANGED ON PURPOSE (Gerard): named,
// enumerated, and still asserted against the source.
//
// It was not loosened. The temptation with a guard that starts failing is to
// widen it until it passes — drop the count, match a pattern, allow a directory —
// and a guard relaxed to accommodate a change stops being a guard. So the two
// spenders are listed, they are checked to spend on DIFFERENT vendors, and every
// other route is still checked to spend on neither.
//
// The two are different in kind, which is why each is named rather than the pair
// being treated as "the spenders":
//
//   profiles/route.ts            SiteX. One credit. Buys the property.
//   profiles/[id]/tax/route.ts   TitlePoint. One call. Buys page 4, on a
//                                property already paid for.
//
// A third one appearing should break this file.
describe('exactly two routes can spend, and they spend on different vendors', () => {
  const generate = read('profiles/route.ts');
  const tax = read('profiles/[id]/tax/route.ts');
  const free = [
    'profiles/[id]/criteria/route.ts', 'profiles/[id]/render/route.ts',
    'profiles/[id]/pdf/route.ts', 'profiles/[id]/resume/route.ts',
  ];

  it('only the generate route imports the generator', () => {
    expect(generate).toContain('generateConciergeProfile');
    for (const f of [...free, 'profiles/[id]/tax/route.ts']) {
      expect(read(f), f).not.toContain('generateConciergeProfile');
      expect(read(f), f).not.toMatch(/integrations\/sitex/);
    }
  });

  it('only the tax route reaches TitlePoint, and it never reaches SiteX', () => {
    // THE SEPARATION IS THE POINT. The property has already been bought from
    // SiteX; page 4 must cost a TitlePoint call and nothing else. A tax route
    // that could reach the generator would buy the property a second time.
    expect(tax).toContain('requestTaxDetail');
    expect(tax).not.toMatch(/integrations\/sitex|generateConciergeProfile/);

    // And the generate route must not have quietly grown a tax call. That would
    // put a create-poll-fetch taking minutes inside the request that charges,
    // which is the charged-but-incomplete failure resume exists for.
    expect(generate).not.toContain('requestTaxDetail');
    expect(generate).not.toMatch(/integrations\/titlepoint/);

    for (const f of free) {
      expect(read(f), f).not.toContain('requestTaxDetail');
      expect(read(f), f).not.toMatch(/integrations\/titlepoint/);
    }
  });

  it('the tax route is gated like a spender, not like a free route', () => {
    // The free routes are deliberately NOT gated on the feature flag, so that
    // turning generation off cannot strand an existing profile. This one spends,
    // so it sits on the other side of that line — and the gate comes before the
    // id is even parsed.
    expect(tax).toContain('denyConciergeGeneration(session.role)');
    expect(tax.indexOf('denyConciergeGeneration')).toBeLessThan(tax.indexOf('requestTaxDetail'));
  });

  it('the tax route names the charge after its vendor', () => {
    // The two vendors are never blended: a `creditsCharged` key on this route
    // would read as SiteX and land in the wrong column in somebody's head.
    //
    // COMMENTS STRIPPED FIRST. The first version of this assertion failed
    // against correct code, because the comment on the route explaining why it
    // does NOT use that name contains the name. An assertion that reads its own
    // documentation asserts nothing — and this one had the decency to fail
    // rather than pass, which is the luckier half of that mistake.
    const code = stripComments(tax);
    expect(code).toContain('titlePointCharges');
    expect(code).not.toMatch(/creditsCharged|sitexCreditsCharged/);
  });

  // The bridge is read with comments stripped throughout. Its docblocks discuss
  // every name these assertions look for — "createServicePreOrderTax",
  // "buying it again", the claim — so reading them raw would make the checks
  // pass on prose.
  const bridge = () => stripComments(read('../../../lib/domain/concierge/tax-bridge.ts'));

  it('only the bridge originates a TitlePoint charge for Concierge', () => {
    // One door. The route is a thin wrapper; if a second module starts calling
    // createService the count above stops meaning anything.
    const src = bridge();
    expect(src).toContain('createServicePreOrderTax');
    // It re-uses the pre-order path rather than inventing one — order_id is
    // nullable, which is what makes a search with no order behind it possible —
    // and it takes the claim on the tax scope, not the property scope.
    expect(src).toContain("scopedClaimKey(propertyKey, 'tax')");
    expect(src).toContain('releaseClaim');
  });

  it('a timeout leaves the search paid for and finishable, never re-bought', () => {
    const src = bridge();
    const marker = 'export async function finishTaxDetail';
    // ANCHORED ON SOMETHING OTHER THAN WHAT IT ASSERTS. If the function is
    // renamed this fails with "finisher not found" rather than quietly checking
    // an empty string and passing.
    expect(src, 'finisher not found').toContain(marker);
    const finish = src.slice(src.indexOf(marker));

    expect(finish).not.toContain('createServicePreOrderTax');
    expect(finish).toContain('titlePointCharges: 0');
    // The status must stay pending on a timeout. 'failed' would invite the next
    // click to buy a search we already own.
    expect(finish).toMatch(/status: 'pending'/);
  });

  it('the claim is given back only where nothing was spent', () => {
    // releaseClaim must appear only BEFORE the create succeeds. A release after
    // the spend would let the next click buy the same search again — the exact
    // inverse of the guard's purpose.
    const src = bridge();
    const createdAt = src.indexOf('const tp = created.data');
    expect(createdAt, 'spend boundary not found').toBeGreaterThan(0);
    const afterTheMoney = src.slice(createdAt);
    expect(afterTheMoney).not.toContain('releaseClaim');
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
    // The work moved to lib/domain/concierge/retry.ts, shared with the Reports
    // list's "Try again"; the route answers with what it did and what it cost.
    const resume = read('profiles/[id]/resume/route.ts');
    expect(resume).toContain('resumeFromStored');
    expect(resume).toContain('creditsCharged: 0');
    const domain = read('../../../lib/domain/concierge/retry.ts');
    expect(domain).toContain('ingestPayload');
    expect(domain).toContain('rawStorageKey');
    expect(domain).toMatch(/cannot be finished without buying it again/);
    expect(domain).not.toMatch(/integrations\/sitex|generateConciergeProfile/);
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
