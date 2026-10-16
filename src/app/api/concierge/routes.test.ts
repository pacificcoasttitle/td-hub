import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/test-support/read-source';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

// ─── THREE routes may spend, and ONE function does the spending. ────────────
//
// This described ONE spender until 2026-09-30 and TWO until 2026-10-16, each
// time by name. The resolve-first flow adds a third, so the rule is being
// CHANGED ON PURPOSE (Gerard): named, enumerated, and still asserted against
// the source.
//
// It was not loosened. The temptation with a guard that starts failing is to
// widen it until it passes — drop the count, match a pattern, allow a
// directory — and a guard relaxed to accommodate a change stops being a guard.
// So the three are listed, and every other route is still checked to spend on
// nothing.
//
//   resolve/route.ts             SiteX. One credit. Buys the property, with
//                                nothing filled in and no document.
//   profiles/route.ts            SiteX. One credit. The orders flow's
//                                single-shot: resolve and finalise together,
//                                where the property comes off the order and
//                                there is no gate to put in front of anyone.
//   profiles/[id]/tax/route.ts   TitlePoint. One call. Buys page 4, on a
//                                property already paid for.
//
// ─── THE COUNT IS NOT THE REAL GUARD ANY MORE ───────────────────────────────
//
// Two of the three now spend on the SAME vendor, which is what the previous
// version of this file checked. Rather than drop that check for a weaker one,
// it is replaced by the stronger fact underneath it: both SiteX spenders reach
// the vendor through resolveProperty, and resolveProperty holds the only call
// in the codebase. The number of routes is incidental; the number of places a
// credit can leave is one, and that is asserted below.
//
// A fourth route appearing should break this file.
describe('exactly three routes can spend, and one function does the spending', () => {
  const generate = read('profiles/route.ts');
  const resolve = read('resolve/route.ts');
  const tax = read('profiles/[id]/tax/route.ts');
  const free = [
    'profiles/[id]/criteria/route.ts', 'profiles/[id]/render/route.ts',
    'profiles/[id]/pdf/route.ts', 'profiles/[id]/resume/route.ts',
    // The second half of the resolve-first flow. It renders a property that
    // was already paid for and cannot reach the vendor to buy another.
    'profiles/[id]/finalise/route.ts',
    // MyNHD's hazard preview. It reaches a VENDOR and still belongs in this
    // list: Gerard, 12 Oct 2026 — the preview costs PCT nothing. "Free" here
    // means "spends no money", not "makes no call", and the distinction is
    // exactly what this file is for. If MyNHD ever starts billing, this entry
    // is wrong and moving it is a decision somebody has to make on purpose.
    'profiles/[id]/nhd/route.ts',
  ];

  it('only the generate route imports the generator', () => {
    expect(generate).toContain('generateConciergeProfile');
    for (const f of [...free, 'resolve/route.ts', 'profiles/[id]/tax/route.ts']) {
      expect(read(f), f).not.toContain('generateConciergeProfile');
      expect(read(f), f).not.toMatch(/integrations\/sitex/);
    }
  });

  it('only the resolve route buys a property on its own', () => {
    expect(resolve).toContain('resolveProperty');
    // And it buys ONLY that. No render, no gate, no second vendor — a route
    // that spends should do one thing, so there is nothing after the money
    // that can fail and leave the credit unaccounted for.
    expect(resolve).not.toContain('renderProfile');
    expect(resolve).not.toContain('finaliseProfile');
    expect(resolve).not.toMatch(/requestTaxDetail|requestHazardPreview/);
    // It cannot be handed a prepared-for name, because at this point in the
    // flow nobody has typed one. Accepting it here is how the gate creeps back
    // in front of the lookup.
    expect(stripComments(resolve)).not.toContain('preparedForName');

    for (const f of [...free, 'profiles/[id]/tax/route.ts']) {
      expect(read(f), f).not.toContain('resolveProperty');
    }
  });

  it('ONE function holds the only call to SiteX', () => {
    // The real guard, now that two routes spend on the same vendor. Counting
    // routes stopped being the invariant; counting the calls did not.
    //
    // Both SiteX spenders reach the vendor through resolveProperty, and
    // generateConciergeProfile is resolve-then-finalise rather than a second
    // implementation — so "the same call" is true by construction instead of
    // by coincidence.
    const domain = stripComments(read('../../../lib/domain/concierge/generate.ts'));
    const calls = domain.match(/fetchConciergeProfile\(/g) ?? [];
    expect(calls, 'exactly one call site, in resolveProperty').toHaveLength(1);

    // And it is inside resolve, above finalise — not in the combined path,
    // which must get there through resolve or not at all.
    const resolveAt = domain.indexOf('export async function resolveProperty');
    const finaliseAt = domain.indexOf('export async function finaliseProfile');
    const callAt = domain.indexOf('fetchConciergeProfile(');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(finaliseAt).toBeGreaterThan(resolveAt);
    expect(callAt).toBeGreaterThan(resolveAt);
    expect(callAt).toBeLessThan(finaliseAt);

    // No other domain module may import the feed client at all. Matched on the
    // IMPORT PATH, not the word: render.ts legitimately reads the
    // `sitexSearchId` and `sitexRequestedAt` columns off a stored row, and a
    // guard that forbade the word would have to be deleted the first time
    // somebody printed the search id on the document.
    for (const m of ['retry.ts', 'render.ts', 'ingest.ts', 'already-have.ts']) {
      expect(stripComments(read(`../../../lib/domain/concierge/${m}`)), m)
        .not.toMatch(/from '[^']*integrations\/sitex/);
    }
  });

  it('finalise renders a paid-for property and cannot buy another', () => {
    // "Generate renders only, never looks up" (Gerard, 16 Oct 2026). The half
    // the operator can get wrong is the half that costs nothing.
    const fin = stripComments(read('profiles/[id]/finalise/route.ts'));
    expect(fin).toContain('finaliseProfile');
    expect(fin).toContain('creditsCharged: 0');
    expect(fin).not.toMatch(/integrations\/sitex|resolveProperty|generateConciergeProfile/);
    // A profile with no stored payload must be refused, not re-fetched. The
    // refusal lives in the domain; this is the message that proves it is wired.
    const domain = stripComments(read('../../../lib/domain/concierge/generate.ts'));
    expect(domain).toContain('NO_PAYLOAD_MESSAGE');
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

  it('the hazard route reaches MyNHD and nothing else, and records no charge', () => {
    // A vendor call that costs nothing is still a vendor call, and it must not
    // be able to reach either of the two that do cost.
    const nhd = stripComments(read('profiles/[id]/nhd/route.ts'));
    expect(nhd).toContain('requestHazardPreview');
    expect(nhd).not.toMatch(/integrations\/sitex|integrations\/titlepoint/);
    expect(nhd).not.toContain('generateConciergeProfile');
    expect(nhd).not.toContain('requestTaxDetail');

    // NOTHING THAT READS AS MONEY. `charges` is on the response and is always
    // 0, so a caller totalling the cost of an action does not have to know
    // which vendor it was. A credit or a charge COUNT appearing here means
    // somebody started billing and this test should be the thing that notices.
    expect(nhd).not.toMatch(/creditsCharged|titlePointCharges|sitexCreditsCharged/);
    expect(nhd).toMatch(/charges: outcome\.charges/);

    // And neither spender grew a hazard call. A free vendor round trip inside
    // the request that charges is still a way to make a paid generate fail
    // after the money is gone.
    expect(stripComments(generate)).not.toContain('requestHazardPreview');
    expect(stripComments(tax)).not.toContain('requestHazardPreview');
  });

  it('only the hazard bridge reaches MyNHD, and it claims on its own scope', () => {
    const src = stripComments(read('../../../lib/domain/concierge/nhd-bridge.ts'));
    expect(src).toContain('fetchFloodFirePreview');
    // Its own scope, so a hazard attempt cannot block a tax purchase on the
    // same property — the same reason 'tax' is not 'profile'.
    expect(src).toContain("scopedClaimKey(propertyKey, 'nhd')");
    // And it buys nothing, so the claim always goes back on failure. That is
    // the OPPOSITE of tax-bridge, which keeps the claim once the money is gone.
    expect(src).toContain('releaseClaim');
    expect(src).not.toMatch(/sitexCreditsCharged|titlePointCharges/);
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

  it('a multi-match comes back as a choice, not a 502', () => {
    // "SiteX returned HTTP 300" in a red box is what the operator saw 14 times
    // in 53 minutes on 2026-10-08, charging nothing each time. A 300 is SiteX
    // asking which property; the answer has to travel with the question or the
    // question cannot be answered.
    const src = stripComments(generate);
    expect(src).toContain("reason: 'ambiguous_match'");
    expect(src).toContain('candidates');
    // 409, the same code `already_have` uses, because both are choices with
    // nothing spent — and NOT the 502 that still covers real failures.
    const choice = src.indexOf("reason: 'ambiguous_match'");
    const fiveOhTwo = src.indexOf('status: 502');
    expect(choice).toBeGreaterThan(-1);
    expect(fiveOhTwo).toBeGreaterThan(-1);
    expect(choice).toBeLessThan(fiveOhTwo);
  });

  it('accepts a picked parcel, and requires a five-digit FIPS with it', () => {
    // The parcel selects which property to ask about; SiteX's answer still
    // goes through the full guard. A FIPS that is not five digits cannot be a
    // county code, and `apn` without one is the shape that failed every time
    // in the orders flow.
    const src = stripComments(generate);
    expect(src).toMatch(/apn:\s*z\.string\(\)/);
    expect(src).toMatch(/fips:\s*z\.string\(\)[\s\S]{0,80}\\d\{5\}/);
  });

  it('the parcel reaches the vendor call rather than being parsed and dropped', () => {
    const gen = stripComments(read('../../../lib/domain/concierge/generate.ts'));
    // Passed INTO the one call that spends, not merely accepted by the route.
    const call = gen.indexOf('fetchConciergeProfile({');
    expect(call).toBeGreaterThan(-1);
    expect(gen.slice(call, call + 320)).toMatch(/apn:\s*input\.apn/);
    expect(gen.slice(call, call + 320)).toMatch(/fips:\s*input\.fips/);
    // And what we SEARCHED BY is recorded, which is a different question from
    // what came back — the orders flow learned that on 2026-09-09.
    expect(gen).toContain('requestedApn');
    expect(gen).toContain('requestedFips');
  });

  it('the candidates are written to the row, not only returned to the browser', () => {
    // Closing the modal must not throw away the only answer to the question.
    const gen = stripComments(read('../../../lib/domain/concierge/generate.ts'));
    expect(gen).toContain('matchCandidates');
  });

  it('the PDF route never accepts a storage key from the browser', () => {
    const pdf = read('profiles/[id]/pdf/route.ts');
    expect(pdf).toContain('getProfilePdfKey(id)');
    expect(pdf).not.toMatch(/searchParams\.get\(['"](key|url|storageKey)/);
  });
});
