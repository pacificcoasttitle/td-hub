import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema';
import { uploadFile } from '@/lib/integrations/s3/client';
import { fetchFloodFirePreview, type PreviewFailure } from '@/lib/integrations/mynhd/client';
import { configRefusalMessage, readConfig } from '@/lib/integrations/mynhd/auth';
import { claimProperty, propertyRequestKey, releaseClaim, scopedClaimKey } from './claim';
import { pngSize } from './png-size';
import { renderProfile } from './render';

// ─── The MyNHD hazard bridge: the hazard sheet ───────────────────────────────
//
// Spec: docs/vendor-reports/mynhd/CONCIERGE_MYNHD_PREVIEW.md
//
// FOLLOWS tax-bridge.ts DELIBERATELY AND ALMOST EXACTLY. Read that file first;
// its reasoning is the reasoning here. The differences are the ones that
// matter, and they are these three:
//
// ─── 1. IT IS FREE, AND THAT CHANGES WHAT THE CLAIM IS FOR ──────────────────
//
// Gerard, 12 Oct 2026: no cost to PCT. So there is no charge to record, no
// credit to reconcile, and the route that calls this is asserted NOT to be one
// of the two named spenders in routes.test.ts.
//
// The claim key still applies — scopedClaimKey(key, 'nhd'). Not to protect
// money: to stop two clicks making two vendor calls against somebody else's
// service, and to stop two concurrent renders of the same profile racing each
// other's PDF upload. A vendor call is a vendor call even when nobody bills.
//
// And because nothing is spent, THE CLAIM IS ALWAYS GIVEN BACK on failure.
// tax-bridge keeps the claim once TitlePoint accepts the create, because the
// money is gone by then and a second click must not spend again. Here there is
// no such moment, so a failed attempt must not lock the profile out of trying
// again — which is the opposite decision from the same principle.
//
// ─── 2. ONE CALL, NOT create-poll-fetch ─────────────────────────────────────
//
// MyNHD answers in one round trip with the bytes in the body. So there is no
// `pending with a vendor id` state to resume into: `pending` here means "we
// started and did not finish", and the only safe thing to do with it is start
// over, which costs nothing. The sweeper does exactly that.
//
// 'fetched' is still a state, and for tax-bridge's reason unchanged: it means
// the PNG is stored but the document has not been re-rendered yet. Profile 9 is
// why 'ready' has to mean "on the document" — status said ready over a PDF
// written five seconds before its own search started.
//
// ─── 3. BY APN + FIPS, WHICH IS WHY A MULTI-MATCH SHOULD NOT HAPPEN ─────────
//
// The profile's own SiteX payload supplies both, and they identify one parcel.
// MyNHD's multi_result is handled anyway — see client.ts — because "should
// never" is not a guard, and the SiteX 300 was also a case nobody expected on
// an address an operator had already picked.

export type HazardStatus = 'pending' | 'fetched' | 'ready' | 'failed';

/**
 * The refusals that say something about THIS PARCEL, and so belong on the row.
 *
 * Everything absent from this set is about us or about the moment — no key,
 * a crossed environment, bad credentials, no entitlement, an unreachable
 * vendor — and would read identically on every profile in the table. Writing
 * it onto the one row somebody clicked claims the parcel is at fault and
 * offers a retry that cannot succeed until a configuration changes.
 *
 * A SET RATHER THAN A NEGATED LIST, on purpose. A new PreviewFailure added to
 * the client defaults to "not about the parcel", which is the safe direction:
 * the cost of being wrong that way is a refusal nobody can see in the list,
 * and the cost of the other way is a permanent mark on a client's document.
 */
const ABOUT_THIS_PARCEL: ReadonlySet<PreviewFailure> = new Set([
  // MyNHD found several properties for the parcel. Should not happen on an
  // APN search, which is why it is worth recording when it does.
  'multi_result',
  // success:true and no usable PNG. About the response, and specific to it.
  'no_image',
  // The vendor declined and said why. Carries its own message.
  'api_error',
]);

export interface HazardOutcome {
  ok: boolean;
  profileId: number;
  status: HazardStatus | 'refused';
  message: string;
  /**
   * Stated on every outcome, and always zero.
   *
   * Not decoration. The tax outcome carries a real number, the two read almost
   * identically at a call site, and a caller that totals "what did this action
   * cost" must not have to know which vendor it was talking to.
   */
  charges: 0;
}

const refuse = (profileId: number, message: string): HazardOutcome =>
  ({ ok: false, profileId, status: 'refused', message, charges: 0 });

/**
 * Add the hazard preview to a profile that does not have one.
 *
 * FREE, so this is not a spender. Safe to call repeatedly: a second call on a
 * 'ready' profile does nothing, and a call on a 'fetched' one only re-renders.
 */
export async function requestHazardPreview(profileId: number): Promise<HazardOutcome> {
  const [profile] = await db.select().from(conciergeProfiles)
    .where(eq(conciergeProfiles.id, profileId)).limit(1);
  if (!profile) return refuse(profileId, 'Profile not found.');

  // Nothing to attach a sheet to. Same gate as tax: a profile whose SiteX
  // retrieval failed has no document to add a page to.
  if (!profile.rawStorageKey) {
    return refuse(profileId, 'This profile has no retrieved property data, so there is nothing to add a hazard preview to.');
  }

  if (profile.hazardStatus === 'ready') {
    return { ok: true, profileId, status: 'ready', charges: 0, message: 'The hazard preview is already on this profile.' };
  }

  // Already stored, only the render outstanding. Free, and the common case
  // after a render failure or a closed tab.
  if (profile.hazardStatus === 'fetched' && profile.hazardStorageKey) {
    return renderHazardSheet(profileId);
  }

  // ─── CAN THIS DEPLOY CALL MyNHD AT ALL ───────────────────────────────────
  //
  // Checked HERE, before the claim and before anything is written to the row.
  //
  // Without this, a click on a deploy with no MyNHD key — which is every
  // deploy until MyNHD issues a production one — took the claim, set
  // hazard_requested true and hazard_status 'pending', then got
  // 'not_configured' back from the client and wrote 'failed' with "MyNHD is
  // not configured" into hazard_error. So a configuration gap left a
  // PERMANENT FAILED MARK on a client's profile, and the row action then
  // offered "Retry hazard preview — last attempt: MyNHD is not configured",
  // which is a retry of nothing.
  //
  // A deploy that cannot make the call has not failed at it. This is the same
  // kind of refusal as the two above — our own gap, reported as ours, with
  // nothing written and nothing attempted.
  const config = readConfig();
  if (!config.ok) {
    return refuse(profileId, configRefusalMessage(config.reason));
  }

  // ─── APN + FIPS, both required ────────────────────────────────────────────
  //
  // Reported as OUR gap rather than the vendor's, and without asking: sending
  // a request we can see is incomplete spends a round trip to be told so. The
  // orders flow established that on `apn` with no FIPS, 13 times.
  const apn = (profile.subjectApn ?? '').trim();
  const fips = (profile.subjectFips ?? '').trim();
  if (apn === '' || fips === '') {
    return refuse(
      profileId,
      'This profile has no parcel number and county code from SiteX, so a hazard preview cannot be looked up.',
    );
  }

  const propertyKey = profile.propertyKey ?? propertyRequestKey({
    street: profile.requestedAddress,
    city: profile.requestedCity ?? '',
    state: profile.requestedState ?? '',
    zip: profile.requestedZip ?? '',
  });
  const claimKey = scopedClaimKey(propertyKey, 'nhd');
  const claim = await claimProperty(claimKey);
  if (!claim.held) {
    return refuse(profileId, 'A hazard preview for this property was started moments ago.');
  }

  const startedAt = new Date();
  await db.update(conciergeProfiles).set({
    hazardRequested: true,
    hazardStatus: 'pending',
    hazardRequestedAt: startedAt,
    hazardError: null,
  }).where(eq(conciergeProfiles.id, profileId));

  const result = await fetchFloodFirePreview({
    apn, fips, state: (profile.requestedState ?? 'CA').trim().toUpperCase(),
  });

  // The vendor's own account of what it did, stored whatever happened. A
  // refused preview has to be explicable in December, and "it didn't work" is
  // not something anybody can act on then.
  const vendorCols = {
    hazardSuccess: result.evidence?.success ?? null,
    hazardCode: result.evidence?.code ?? null,
    hazardHttpStatus: result.evidence?.httpStatus ?? null,
    hazardDurationMs: result.durationMs,
  };

  if (!result.ok) {
    // NOTHING WAS SPENT, so the claim goes back — the opposite of tax-bridge
    // after a create, and for the same underlying reason. Entitlement and
    // vendor availability both change; a failed attempt must not lock the
    // profile out of trying again.
    await releaseClaim(claimKey);

    // ─── MARK THE ROW ONLY WHEN THE ANSWER IS ABOUT THIS PARCEL ───────────
    //
    // The early readConfig() refusal above stops a MISSING key from writing
    // 'failed' onto a client's profile. It cannot stop a WRONG one: a key is
    // an opaque string, so a dev key on the production target reads as
    // perfectly valid configuration and is refused by MyNHD instead of by us.
    // That was the live state on the production deploy the day this shipped —
    // health reported configured:true, productionHost:true, ok:true, and a
    // click would have come back 401.
    //
    // Which is the same defect wearing a vendor's status code. An account or
    // environment problem is identical for EVERY profile: marking the one row
    // an operator happened to click says the parcel is the problem, offers a
    // retry that cannot succeed until a config change, and leaves a dozen
    // rows stained by the time anybody notices.
    //
    // So the row records only what is about the parcel or the response:
    // multi_result, no_image, api_error. Everything else — our configuration,
    // our credentials, our entitlement, a network blip — is a REFUSAL, with
    // nothing written.
    if (!ABOUT_THIS_PARCEL.has(result.reason)) {
      // PUT THE ROW BACK, rather than leaving the pre-call write in place.
      //
      // 'pending' was written before the call, so that a crash mid-flight
      // leaves a trace the row action can offer to retry. On an account
      // refusal that same trace is the defect in a different costume: the
      // control reads 'pending' as "did not finish — try again", which is
      // exactly the retry-of-nothing this is meant to stop.
      //
      // So the row goes back to untouched. A crash still leaves 'pending',
      // because a crash never reaches this line.
      await db.update(conciergeProfiles).set({
        hazardRequested: false,
        hazardStatus: null,
        hazardError: null,
        hazardRequestedAt: null,
        // The vendor's account of itself is NOT kept. It describes our
        // configuration, not this property, and the vendor log already has it
        // with the host and target beside it.
        hazardSuccess: null,
        hazardCode: null,
        hazardHttpStatus: null,
        hazardDurationMs: null,
      }).where(eq(conciergeProfiles.id, profileId));
      return refuse(profileId, result.message);
    }

    await db.update(conciergeProfiles).set({
      ...vendorCols,
      hazardStatus: 'failed',
      hazardError: result.message.slice(0, 2000),
    }).where(eq(conciergeProfiles.id, profileId));
    return { ok: false, profileId, status: 'failed', charges: 0, message: result.message };
  }

  // ─── The bytes, measured and stored before anything lays them out ─────────
  //
  // Same ordering as the raw SiteX payload in generate.ts: what the vendor sent
  // goes to storage before anything parses or renders it. The dimensions come
  // from the PNG's own IHDR, because the sheet's layout depends on them and
  // "it looked fine on screen" is not a measurement.
  const size = pngSize(result.png);
  const key = `concierge/${profileId}/mynhd-hazard.png`;
  const up = await uploadFile({ key, buffer: result.png, contentType: 'image/png' });

  if (!up.success) {
    await releaseClaim(claimKey);
    await db.update(conciergeProfiles).set({
      ...vendorCols,
      hazardStatus: 'failed',
      hazardError: 'The hazard preview was fetched but could not be stored.',
    }).where(eq(conciergeProfiles.id, profileId));
    return {
      ok: false, profileId, status: 'failed', charges: 0,
      message: 'MyNHD returned a preview but it could not be stored. Nothing was charged; asking again will fetch it afresh.',
    };
  }

  await db.update(conciergeProfiles).set({
    ...vendorCols,
    hazardStatus: 'fetched',
    hazardStorageKey: key,
    hazardSha256: crypto.createHash('sha256').update(result.png).digest('hex'),
    hazardBytes: result.png.length,
    hazardWidth: size?.width ?? null,
    hazardHeight: size?.height ?? null,
    hazardOrderLink: result.orderLink,
    hazardError: null,
  }).where(eq(conciergeProfiles.id, profileId));

  // The claim is released once the bytes are safe. Nothing was bought, and the
  // thing the claim was protecting — one vendor call, one render at a time — is
  // done with by here; renderHazardSheet is idempotent on its own.
  await releaseClaim(claimKey);

  // ─── NOTHING IS KICKED OFF AFTER THE RESPONSE ─────────────────────────────
  //
  // No `void renderHazardSheet(...)`. A serverless function is free to freeze
  // once it has answered, and on profile 9 it did: the DB write survived and
  // the render did not, and the promise that would have reported the problem
  // was the promise that died. The render happens here, inside the request
  // somebody is waiting on, and the sweeper catches anything left at 'fetched'.
  return renderHazardSheet(profileId);
}

/**
 * Put the stored PNG on the document. FREE and idempotent.
 *
 * Separate from the fetch so a failed render is a thing to retry on its own,
 * without going back to the vendor for bytes we already hold.
 */
export async function renderHazardSheet(profileId: number): Promise<HazardOutcome> {
  const rendered = await renderProfile(profileId);

  if (!rendered.ok) {
    // STAYS 'fetched', with the reason recorded. tax-bridge's lesson: the
    // previous version of that code returned this message to a background
    // promise nobody was listening to, so a failed render left a profile
    // marked ready with a stale document and no trace of why.
    await db.update(conciergeProfiles).set({
      hazardError: `The hazard preview is stored, but the document could not be re-rendered: ${rendered.message}`.slice(0, 2000),
    }).where(eq(conciergeProfiles.id, profileId));
    return {
      ok: false, profileId, status: 'fetched', charges: 0,
      message: `The hazard preview is stored, but the document was not re-rendered: ${rendered.message} Asking again finishes it and costs nothing.`,
    };
  }

  await db.update(conciergeProfiles).set({
    hazardStatus: 'ready',
    hazardError: null,
  }).where(eq(conciergeProfiles.id, profileId));

  return {
    ok: true, profileId, status: 'ready', charges: 0,
    message: 'The hazard preview is on the profile and its sheet has been added.',
  };
}
