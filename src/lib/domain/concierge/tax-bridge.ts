import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles, titlePointData } from '@/lib/db/schema';
import { createServicePreOrderTax } from '@/lib/integrations/titlepoint/client';
import { resolveCaliforniaFips } from '@/lib/integrations/titlepoint/fips';
import { executePipeline } from '@/lib/domain/titlepoint/service';
import { getSetting } from '@/lib/domain/settings/service';
import { claimProperty, propertyRequestKey, releaseClaim, scopedClaimKey } from './claim';
import { parseTitlePointTaxResult } from './titlepoint-tax-report';
import { taxReportHasContent } from './document/derive';
import { renderProfile } from './render';

// ─── The TitlePoint tax bridge: page 4, layer 1 ──────────────────────────────
//
// A TitlePoint tax search BILLS PER CALL. That fact drives every decision here.
//
// ─── IT IS NEVER INSIDE THE PAID GENERATE ───────────────────────────────────
//
// TitlePoint tax is create → poll → fetch and can take minutes. Waiting on it
// inside the request that charges for SiteX would reproduce exactly the
// charged-but-incomplete failure that `resume` exists for: profile 3 lost its
// ingest after the credit was gone. So the profile generates and delivers on
// SiteX alone, this runs afterwards, and when it lands the profile RE-RENDERS
// FREE and page 4 appears.
//
// ─── ON AN EXISTING PROFILE IT SPENDS ON TAX ONLY ───────────────────────────
//
// We have already paid SiteX for the property. Re-running generate would buy it
// twice, so nothing here touches the SiteX path or sitex_credits_charged.
//
// ─── THE CLAIM IS THE SAME MECHANISM, A DIFFERENT SCOPE ─────────────────────
//
// scopedClaimKey(key, 'tax'). Two clicks must not buy two tax searches, and the
// tax claim must not block a legitimate generate on the same property. Extending
// the existing guard was the instruction, because that guard is the one piece of
// Concierge already proven in production — a real double-click came back 409
// with 0 charged.
//
// ─── A TIMEOUT IS ALREADY PAID, AND IS NOT A REASON TO BUY AGAIN ────────────
//
// The moment TitlePoint accepts the create, the money is gone. If the poll then
// times out, the search still exists on their side and the result is still
// fetchable. So `pending` with a titlepoint_data_id means FINISH, never create:
// asking again runs the pipeline over the row we already own, free. This is the
// same shape as resume on the SiteX side, and for the same reason.
//
// ─── A DENIED COUNTY IS FREE, AND RECORDED ANYWAY ───────────────────────────
//
// Verified: 61 denials, zero TitlePoint request ids issued — TitlePoint refuses
// at create_service before doing any work, so there is nothing to bill. The
// claim is given back, because a denial is not a purchase and entitlement can
// change. And the counties are NOT hardcoded: we attempt, fall back on denial,
// and record it. A constant goes stale the day someone buys Mono coverage, and
// worse, we stop noticing the gap exists.

/** TitlePoint's own words when a county is not entitled. */
const DENIAL = /access is currently denied/i;

export type TaxDetailStatus = 'pending' | 'ready' | 'empty' | 'denied' | 'failed';

export interface TaxDetailOutcome {
  ok: boolean;
  profileId: number;
  status: TaxDetailStatus | 'refused';
  /**
   * What THIS call charged — 0 or 1. Not the profile's running total, so a
   * caller can report the cost of the action it just took.
   */
  titlePointCharges: number;
  /** TitlePoint's per-call id, the invoice reconciliation handle. */
  requestId: string | null;
  message: string;
}

const refuse = (profileId: number, message: string): TaxDetailOutcome =>
  ({ ok: false, profileId, status: 'refused', titlePointCharges: 0, requestId: null, message });

/**
 * Buy the tax detail for a profile, or finish one already bought.
 *
 * THE ONLY PLACE A TITLEPOINT CHARGE ORIGINATES for Concierge. The route that
 * calls this is the second of exactly two spenders, and routes.test.ts names
 * both.
 */
export async function requestTaxDetail(profileId: number): Promise<TaxDetailOutcome> {
  const [profile] = await db.select().from(conciergeProfiles)
    .where(eq(conciergeProfiles.id, profileId)).limit(1);
  if (!profile) return refuse(profileId, 'Profile not found.');

  // Nothing to attach a tax page to. A profile whose SiteX retrieval failed has
  // no document, and buying tax for it would be spending on a report that
  // cannot be rendered.
  if (!profile.rawStorageKey) {
    return refuse(profileId, 'This profile has no retrieved property data, so there is nothing to add tax detail to.');
  }

  if (profile.taxDetailStatus === 'ready') {
    return { ok: true, profileId, status: 'ready', titlePointCharges: 0, requestId: profile.titlePointRequestId, message: 'The tax detail is already on this profile. Nothing was charged.' };
  }

  // ALREADY PAID. Finish it; never create a second search.
  if (profile.taxDetailStatus === 'pending' && profile.titlePointDataId) {
    return finishTaxDetail(profileId, profile.titlePointDataId, profile.titlePointRequestId);
  }

  if ((await getSetting('titlepoint_shut_off')) === 'true') {
    return refuse(profileId, 'TitlePoint is switched off, so no tax search was attempted and nothing was charged.');
  }

  const county = (profile.subjectCounty ?? '').trim();
  if (county === '') {
    // The county comes FROM the paid SiteX call, so its absence is a real gap
    // rather than something to guess at: TitlePoint needs it to route.
    return refuse(profileId, 'No county on this profile, so a tax search cannot be routed. Nothing was charged.');
  }

  const propertyKey = profile.propertyKey ?? propertyRequestKey({
    street: profile.requestedAddress,
    city: profile.requestedCity ?? '',
    state: profile.requestedState ?? '',
    zip: profile.requestedZip ?? '',
  });
  const claimKey = scopedClaimKey(propertyKey, 'tax');
  const claim = await claimProperty(claimKey);
  if (!claim.held) {
    return refuse(profileId, 'A tax search for this property was started moments ago. Nothing was charged.');
  }

  const startedAt = new Date();
  await db.update(conciergeProfiles).set({
    taxDetailRequested: true,
    titlePointRequestedAt: startedAt,
    taxDetailError: null,
  }).where(eq(conciergeProfiles.id, profileId));

  // The profile id as the customerRef, so the vendor's own record of the call
  // points back at what we bought it for. This reuses the pre-order path
  // wholesale — title_point_data.order_id is nullable, which is what makes a
  // TitlePoint search possible with no order behind it.
  const customerRef = String(profileId);
  const created = await createServicePreOrderTax({
    address: profile.requestedAddress,
    city: profile.requestedCity ?? '',
    state: profile.requestedState ?? 'CA',
    county,
    fips: resolveCaliforniaFips(county),
    apn: profile.subjectApn ?? undefined,
    searchType: 'tax',
  }, customerRef);

  if (!created.success || !created.data) {
    const message = created.error?.message ?? 'CreateService failed';
    const denied = DENIAL.test(message);

    // Nothing was spent either way, so the claim goes back. Entitlement can
    // change, and a failed attempt must not lock the property out.
    await releaseClaim(claimKey);
    await db.update(conciergeProfiles).set({
      taxDetailStatus: denied ? 'denied' : 'failed',
      taxDetailError: message.slice(0, 2000),
      titlePointDurationMs: Date.now() - startedAt.getTime(),
    }).where(eq(conciergeProfiles.id, profileId));

    return {
      ok: false, profileId, status: denied ? 'denied' : 'failed',
      titlePointCharges: 0, requestId: null,
      message: denied
        ? `${county} County is not entitled for tax searches, so nothing was charged. Page 4 will show the assessment detail we already hold.`
        : `The tax search could not be started, so nothing was charged. ${message}`,
    };
  }

  // ─── The money is gone from here on ───────────────────────────────────────
  //
  // The claim is NOT released on any later failure. The credit is spent, and the
  // next click must not spend another.

  const tp = created.data;
  const [record] = await db.insert(titlePointData).values({
    sessionId: `tp_concierge_${profileId}`,
    requestId: tp.requestId,
    searchType: 'tax',
    status: 'pending',
    metadata: {
      conciergeProfileId: profileId,
      tpOrderId: tp.orderId,
      customerRef,
      userId: 'system:concierge_tax',
      property: { address: profile.requestedAddress, city: profile.requestedCity, state: profile.requestedState, county },
    } as Record<string, unknown>,
  }).returning({ id: titlePointData.id });

  await db.update(conciergeProfiles).set({
    taxDetailStatus: 'pending',
    titlePointRequestId: tp.requestId,
    titlePointDataId: record!.id,
    // ONE CALL, ONE CHARGE. Set rather than incremented: a retry finishes the
    // search we own and must not add a second charge for it.
    titlePointCharges: 1,
  }).where(eq(conciergeProfiles.id, profileId));

  // Background. The caller gets its answer now; page 4 appears when this lands.
  void finishTaxDetail(profileId, record!.id, tp.requestId).catch(async (err) => {
    await db.update(conciergeProfiles).set({
      taxDetailError: (err instanceof Error ? err.message : 'Tax pipeline failed').slice(0, 2000),
    }).where(eq(conciergeProfiles.id, profileId));
  });

  return {
    ok: true, profileId, status: 'pending', titlePointCharges: 1, requestId: tp.requestId,
    message: 'The tax search is running. The profile will re-render itself for free when it lands, and page 4 will appear.',
  };
}

/**
 * Poll, fetch, parse, store, re-render. FREE — the search is already paid for.
 *
 * Safe to call repeatedly. That is the point: a timed-out poll leaves a real
 * search sitting on TitlePoint's side, and finishing it must never look like a
 * reason to buy another.
 */
export async function finishTaxDetail(
  profileId: number,
  titlePointDataId: number,
  requestId: string | null = null,
): Promise<TaxDetailOutcome> {
  const pipeline = await executePipeline(titlePointDataId);

  const [row] = await db.select().from(titlePointData)
    .where(eq(titlePointData.id, titlePointDataId)).limit(1);
  const resultData = ((row?.metadata as Record<string, unknown>) ?? {}).resultData;

  if (!pipeline.success && !resultData) {
    // STAYS 'pending', deliberately. It is paid for and still fetchable, so the
    // next attempt finishes it rather than buying it again. A status of 'failed'
    // here would invite exactly that second purchase.
    const message = pipeline.timedOut
      ? 'The tax search is still running at TitlePoint. It is paid for — asking again will finish it, not buy it again.'
      : (pipeline.error ?? 'The tax result could not be fetched.');
    await db.update(conciergeProfiles).set({
      taxDetailError: message.slice(0, 2000),
    }).where(eq(conciergeProfiles.id, profileId));
    return { ok: false, profileId, status: 'pending', titlePointCharges: 0, requestId, message };
  }

  const parsed = parseTitlePointTaxResult(resultData);

  // "Could not parse" and "the county holds nothing" are different answers.
  // Only the second one is `empty`; the first keeps the row for inspection.
  if (!parsed) {
    await db.update(conciergeProfiles).set({
      taxDetailStatus: 'failed',
      taxDetailError: 'The tax result came back in a shape this could not read.',
    }).where(eq(conciergeProfiles.id, profileId));
    return { ok: false, profileId, status: 'failed', titlePointCharges: 0, requestId, message: 'The tax result came back in a shape this could not read.' };
  }

  const hasContent = taxReportHasContent(parsed.report);

  await db.update(conciergeProfiles).set({
    taxDetailStatus: hasContent ? 'ready' : 'empty',
    // The NORMALIZED report only. The raw stays in title_point_data — see
    // migration 0062 for why that boundary is not cosmetic.
    taxReport: hasContent ? (parsed.report as unknown as Record<string, unknown>) : null,
    taxAssessedBasis: parsed.assessed.basis,
    taxDetailSource: hasContent ? 'titlepoint' : 'sitex',
    taxDetailError: null,
  }).where(eq(conciergeProfiles.id, profileId));

  // The free re-render. This is what makes page 4 appear without anyone
  // clicking anything, and it spends nothing: renderProfile reads the stored
  // payload and never calls a vendor.
  const rendered = await renderProfile(profileId);

  return {
    ok: true, profileId,
    status: hasContent ? 'ready' : 'empty',
    titlePointCharges: 0,
    requestId,
    message: hasContent
      ? (rendered.ok
        ? 'The tax detail is on the profile and page 4 has been added. Nothing further was charged.'
        : `The tax detail is stored, but the re-render failed: ${rendered.message}`)
      : 'The tax search ran and the county holds no record for this parcel. Page 4 will show the assessment detail we already hold.',
  };
}
