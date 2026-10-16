/**
 * Resolve: which property is this, and paying for the answer.
 *
 * ─── THE ONLY MODULE THAT CAN SPEND A SITEX CREDIT ──────────────────────────
 *
 * One call, made once, guarded before it is trusted. Everything the call
 * returned is stored before anything is computed from it, so no later
 * operation ever needs to buy it again — which is what makes the ingest and
 * the render free and unlimited.
 *
 * ─── WHY IT IS NOT IN generate.ts ───────────────────────────────────────────
 *
 * Because finalise renders, and the renderer cannot be imported by a script.
 * @react-pdf/textkit imports `@react-pdf/hyphenate/en-us`, which that package
 * does not list in its `exports`, so any module that transitively reaches
 * @react-pdf dies at import under tsx. While both halves lived together, the
 * spend path inherited that: the 25651 Paseo La Cresta verification could only
 * exercise the feed client and had to say out loud that the archive path was
 * unproven, because the one function that charges could not be reached from a
 * script.
 *
 * Splitting it fixes that by accident of good structure rather than by a
 * patch. A patch WAS tried once and changed what the renderer produced — it
 * enabled hyphenation — so it is not coming back. Now the spend path imports
 * no document at all, and a charged lookup can be verified end to end instead
 * of inferred from a byte count in a log line.
 *
 * Three modules, one direction: resolve buys the payload, ingest derives rows
 * from it, render turns those rows into a document. Nothing upstream imports
 * anything downstream.
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema';
import { downloadFile, uploadFile } from '@/lib/integrations/s3/client';
import {
  fetchConciergeProfile, getConciergeFeedId, guardMessage, type MatchCandidate,
} from '@/lib/integrations/sitex/concierge-feed';
import { normalizeSubject } from './normalize';
import { DEFAULT_CRITERIA } from './comp-filter';
import { criteriaSummary, profileListSubject } from './list-line';
import { claimProperty, propertyRequestKey, recordClaimOutcome, releaseClaim } from './claim';
import {
  alreadyHaveMessage, findProfileForProperty, findResolvedForProperty, type ExistingProfile,
} from './already-have';
// NOT from profile-document.tsx, which re-exports the same string and drags
// @react-pdf in with it — see the module comment above.
import { TEMPLATE_VERSION } from './document/template-version';

// ─── Resolve, then finalise ─────────────────────────────────────────────────
//
// RESOLVE spends the credit. FINALISE renders from what resolve stored and can
// never reach the vendor. The split is the whole point: the question "which
// property is this?" is answered and paid for ONCE, up front, and everything
// the operator does afterwards — prepared-for name, rep, criteria, add-ons —
// is free and repeatable.
//
// Before this split, the gate came first and Generate did both. An operator
// filled in six fields, clicked Generate, and only then discovered the address
// matched four parcels — having already been charged. The picker then re-sent
// the whole form and charged again.
//
// resolveProperty:                        finaliseProfile:
//   0a. already generated? → offer it       1. the stored payload
//   0b. already resolved?  → reuse, free    2. ingest: comps, transfers, maps
//   0c. claim — one caller through          3. render
//   1.  row first, status 'pending'
//   2.  THE CALL
//   3.  guard — evidence kept either way
//   4.  raw to storage, status 'retrieved'
//
// 'retrieved' is not a new word for this. It already meant exactly this state —
// payload archived, nothing rendered — and held zero rows in production; it was
// simply transient, lasting the milliseconds between the upload and the ingest.
// Resolve-first makes it durable and operator-visible. A resolved row and a
// half-finished generation are the same row, which is why `resume` already
// finishes one.

export interface PropertyLookup {
  orderId?: number | null;
  street: string;
  city: string;
  state: string;
  /**
   * Optional since the APN search: a parcel lookup has no postal address, and
   * a fabricated ZIP on the row would be a claim about the property.
   */
  zip?: string;
  /**
   * The parcel the operator picked out of a multi-match. Searched by in
   * preference to the address.
   *
   * Absent on a first attempt and that is not a gap: no APN exists before an
   * address has matched something (claim.ts explains why the duplicate guard
   * cannot key on it either). These arrive only from a 300, which charges
   * nothing — and since the resolve step is the spend, picking a parcel out of
   * a 300 now costs exactly one credit in total rather than two.
   */
  apn?: string | null;
  fips?: string | null;
  createdBy?: string | null;
  /**
   * The operator was shown what we already hold for this property and asked
   * for a fresh lookup anyway.
   *
   * Skips BOTH the generated-profile check and the resolution reuse: someone
   * who has explicitly asked for a fresh lookup is asking for a fresh call,
   * and handing them a resolution from this morning would quietly refuse them.
   */
  allowDuplicate?: boolean;
}

/** What resolve found, and what the gate shows the operator before they commit. */
export interface ResolvedProperty {
  profileId: number;
  creditsCharged: number;
  /**
   * This resolution was already paid for — by this operator's earlier attempt,
   * or by someone else within the window.
   */
  reused: boolean;
  apn: string | null;
  fips: string | null;
  county: string | null;
  /** The address SiteX holds, which is not always the one that was typed. */
  siteAddress: string | null;
  siteCityState: string | null;
  /** Recorded owner, verbatim. The operator's main way of recognising a unit. */
  primaryOwner: string | null;
  useDescription: string | null;
  /** The handle that reconciles the charge against an invoice line. */
  searchId: number | null;
}

export type ResolveOutcome =
  | { ok: true; resolved: ResolvedProperty }
  | {
    ok: false; profileId: number | null; creditsCharged: number; message: string;
    /**
     * The parcels to choose between, when the address matched more than one.
     * The caller shows these and resolves again with `apn`/`fips`. That second
     * resolve is the one that charges — the 300 itself was free.
     */
    candidates?: MatchCandidate[];
  }
  | { ok: false; duplicate: true; profileId: number | null; creditsCharged: 0; message: string }
  | { ok: false; alreadyHave: ExistingProfile; profileId: number; creditsCharged: 0; message: string };
/**
 * THE ONLY FUNCTION THAT SPENDS A CREDIT.
 *
 * Answers "which property is this?", pays for the answer, and stores it. No
 * document, no prepared-for name, no criteria — none of that is known yet, and
 * none of it costs anything.
 */
export async function resolveProperty(input: PropertyLookup): Promise<ResolveOutcome> {
  const feedId = getConciergeFeedId();

  // 0. THE GUARD, BEFORE ANYTHING. Keyed on the property, not the order: the
  //    Reports entry point has no order, and a read-then-write check loses the
  //    race a double-click creates. Exactly one caller comes away holding this.
  const requestKey = propertyRequestKey(input);

  // 0a. DO WE ALREADY OWN THIS? Asked before the claim and before the call, and
  //     answered from the profile rows rather than the claim, which expires.
  //     Informs rather than refuses — a six-month-old profile may legitimately
  //     need refreshing — but the operator has to have said so.
  if (!input.allowDuplicate) {
    const existing = await findProfileForProperty(requestKey);
    if (existing) {
      return {
        ok: false, alreadyHave: existing, profileId: existing.id,
        creditsCharged: 0, message: alreadyHaveMessage(existing),
      };
    }

    // 0b. ALREADY RESOLVED AND NOT YET FINALISED? Then it is paid for, and
    //     finishing it is free. This is the whole answer to two operators
    //     working the same property minutes apart: the first one's claim was
    //     released the moment their lookup succeeded, so without this the
    //     second one buys the same parcel again at full price.
    const held = await findResolvedForProperty(requestKey);
    if (held) {
      const reused = await readResolution(held.id, held.rawStorageKey);
      // Unreadable storage falls through to a fresh call rather than failing:
      // a resolution we cannot read is a resolution we do not have.
      if (reused) return { ok: true, resolved: reused };
    }
  }

  // 0c. THE RACE GUARD. Two clicks a second apart both read nothing above; this
  //     is the statement that lets exactly one of them through.
  const claim = await claimProperty(requestKey);
  if (!claim.held) {
    return {
      ok: false,
      duplicate: true,
      profileId: claim.profileId,
      creditsCharged: 0,
      message: claim.profileId
        ? 'A profile for this property was generated moments ago. Opening that one — nothing was charged.'
        : 'A profile for this property is being generated right now. Nothing was charged.',
    };
  }

  // 1. The row exists before the call does. A profile that fails halfway is a
  //    row with a reason on it, never a missing record and a spent credit.
  const [created] = await db.insert(conciergeProfiles).values({
    orderId: input.orderId ?? null,
    requestedAddress: input.street,
    requestedCity: input.city,
    requestedState: input.state,
    requestedZip: input.zip,
    sitexFeedId: feedId,
    criteriaSameUseCode: DEFAULT_CRITERIA.sameUseCode,
    criteriaLivingAreaPct: DEFAULT_CRITERIA.livingAreaPct,
    criteriaBedDelta: DEFAULT_CRITERIA.bedDelta,
    criteriaBathDelta: DEFAULT_CRITERIA.bathDelta,
    criteriaRadiusMiles: DEFAULT_CRITERIA.radiusMiles === null ? null : String(DEFAULT_CRITERIA.radiusMiles),
    criteriaMonths: DEFAULT_CRITERIA.months,
    criteriaMaxComps: DEFAULT_CRITERIA.maxComps,
    // NO prepared-for name and NO rep. They are not known yet and that is the
    // design: the operator fills them in after seeing which property this is.
    // Both columns are nullable, so a resolution is a legal row rather than a
    // row padded with placeholders that would print on a document if finalise
    // ever forgot to overwrite them.
    templateVersion: TEMPLATE_VERSION,
    status: 'pending',
    // The property, as the guard keys it (migration 0059).
    propertyKey: requestKey,
    // What the Reports list prints. Written now, with the row, so a generation
    // that fails at the vendor is still a legible line rather than a blank one.
    ...profileListSubject(input),
    listSettings: criteriaSummary(DEFAULT_CRITERIA),
    createdBy: input.createdBy ?? null,
  }).returning({ id: conciergeProfiles.id });

  const profileId = created!.id;
  const requestedAt = new Date();

  // 2. THE CALL. One, and only here.
  const result = await fetchConciergeProfile({
    street: input.street, city: input.city, state: input.state, zip: input.zip ?? '',
    apn: input.apn ?? null, fips: input.fips ?? null,
  });

  const candidates = !result.ok ? result.candidates : undefined;

  const guardCols = {
    sitexRequestedAt: requestedAt,
    sitexDurationMs: result.durationMs,
    sitexCreditsCharged: result.creditsCharged,
    isValidAddress: result.guard?.isValidAddress ?? null,
    outsideCoverage: result.guard?.outsideCoverage ?? null,
    locationCount: result.guard?.locationCount ?? null,
    matchMethodCode: result.guard?.matchMethodCode ?? null,
    sitexSearchId: result.guard?.searchId ?? null,
    // What we SEARCHED BY, which is not the same question as what came back.
    requestedApn: input.apn?.trim() || null,
    requestedFips: input.fips?.trim() || null,
    // Written on the row, not only returned, so closing the modal does not
    // throw away the only answer to the question SiteX asked.
    matchCandidates: candidates && candidates.length > 0 ? candidates : null,
  };

  // 3. A guard failure is recorded WITH its evidence and produces no document.
  //    The credits actually charged are stored either way, so a refused
  //    generation that still cost money is visible in the metering.
  if (!result.ok) {
    const message = result.reason === 'not_configured' || result.reason === 'api_error' || result.reason === 'network'
      ? result.message
      : guardMessage(result.reason);
    // ─── ARCHIVE ANYTHING WE PAID FOR, GUARD OR NO GUARD ────────────────
    //
    // The guard protects the DOCUMENT; it has no business destroying the
    // evidence. 25651 Paseo La Cresta bought 65,265 bytes of real property
    // data and this path discarded every one of them, so what SiteX actually
    // returned could only be inferred from a length in a log line — on the
    // very call that proved the guard itself was wrong.
    //
    // Charged and refused is the case that most needs the bytes kept: it is
    // unrecoverable without a second purchase.
    const refusedRaw = 'raw' in result ? result.raw : undefined;
    let refusedKey: string | null = null;
    if (result.creditsCharged > 0 && refusedRaw) {
      const buf = Buffer.from(refusedRaw, 'utf8');
      const key = `concierge/${profileId}/sitex-raw.json`;
      const up = await uploadFile({ key, buffer: buf, contentType: 'application/json' });
      refusedKey = up.success ? key : null;
    }

    await db.update(conciergeProfiles)
      .set({
        ...guardCols,
        status: 'failed',
        errorMessage: message,
        // Only when there is something there. A key for an object that failed
        // to upload is worse than none.
        ...(refusedKey ? {
          rawStorageKey: refusedKey,
          rawSha256: crypto.createHash('sha256').update(Buffer.from(refusedRaw!, 'utf8')).digest('hex'),
          rawBytes: Buffer.byteLength(refusedRaw!, 'utf8'),
        } : {}),
      })
      .where(eq(conciergeProfiles.id, profileId));
    // Nothing spent — give the property back, so a corrected retry is not
    // locked out for the window. If it DID charge, the claim stands: the credit
    // is gone and a second click must not spend another.
    if (result.creditsCharged === 0) await releaseClaim(requestKey);
    else await recordClaimOutcome(requestKey, profileId, null);
    return { ok: false, profileId, creditsCharged: result.creditsCharged, message, candidates };
  }

  // The call charged, so the claim is now permanent for its window whatever
  // happens next. Recorded here rather than at the end, because every path
  // below this point has already spent the credit.
  await recordClaimOutcome(requestKey, profileId, null);

  // 4. RAW TO STORAGE BEFORE ANYTHING PARSES IT. We are not paying twice for a
  //    payload lost to a parse error.
  const rawBuf = Buffer.from(result.raw, 'utf8');
  const rawKey = `concierge/${profileId}/sitex-raw.json`;
  const rawUp = await uploadFile({ key: rawKey, buffer: rawBuf, contentType: 'application/json' });

  await db.update(conciergeProfiles).set({
    ...guardCols,
    status: 'retrieved',
    rawStorageKey: rawUp.success ? rawKey : null,
    rawSha256: crypto.createHash('sha256').update(rawBuf).digest('hex'),
    rawBytes: rawBuf.length,
  }).where(eq(conciergeProfiles.id, profileId));

  if (!rawUp.success) {
    const message = 'The property data was retrieved but could not be stored, so the profile cannot be reproduced. Not generating a document from data we cannot keep.';
    await db.update(conciergeProfiles)
      .set({ status: 'failed', errorMessage: message })
      .where(eq(conciergeProfiles.id, profileId));
    return { ok: false, profileId, creditsCharged: result.creditsCharged, message };
  }

  // 5. WHICH PROPERTY IT TURNED OUT TO BE. Identity only — the APN, the county,
  //    what it is. Not the valuations, the comparables or the transfers: those
  //    are derived work, and derived work belongs to finalise, which can redo
  //    it for nothing as often as the criteria change.
  const subject = normalizeSubject((result.payload.Feed ?? {}) as Record<string, unknown>);
  await db.update(conciergeProfiles).set({
    subjectApn: subject.apn, subjectFips: subject.fips, subjectCounty: subject.county,
    subjectUseCode: subject.useCode, subjectUseDescription: subject.useDescription,
  }).where(eq(conciergeProfiles.id, profileId));

  // The property this address turned out to be. Evidence on the claim, not the
  // pre-spend key — the APN does not exist until the call has been paid for.
  await recordClaimOutcome(requestKey, profileId, subject.apn ?? null);

  return {
    ok: true,
    resolved: {
      profileId,
      creditsCharged: result.creditsCharged,
      reused: false,
      searchId: result.guard?.searchId ?? null,
      ...displayFields(subject),
    },
  };
}

/** The property as the gate shows it. One mapping, used by both resolve paths. */
function displayFields(subject: ReturnType<typeof normalizeSubject>) {
  return {
    apn: subject.apn,
    fips: subject.fips,
    county: subject.county,
    siteAddress: subject.siteAddress,
    siteCityState: subject.siteCityState,
    primaryOwner: subject.primaryOwner,
    useDescription: subject.useDescription,
  };
}

/**
 * A resolution read back off storage, for the operator who did not pay for it.
 *
 * Returns null on anything unreadable, which the caller treats as "no
 * resolution" and pays for a fresh one. Deliberately not an error: a stored
 * object we cannot parse must not be able to block a property from ever being
 * looked up again.
 */
async function readResolution(
  profileId: number,
  rawStorageKey: string,
): Promise<ResolvedProperty | null> {
  const raw = await downloadFile(rawStorageKey);
  if (!raw.success || !raw.data) return null;

  let payload: { Feed?: Record<string, unknown>; OrderInfo?: { SearchId?: number } };
  try {
    payload = JSON.parse(raw.data.toString('utf8')) as typeof payload;
  } catch {
    return null;
  }

  const subject = normalizeSubject((payload.Feed ?? {}) as Record<string, unknown>);
  return {
    profileId,
    // Nothing was charged for THIS request. The credit is on the row that
    // first resolved it, where the metering already counts it once.
    creditsCharged: 0,
    reused: true,
    searchId: payload.OrderInfo?.SearchId ?? null,
    ...displayFields(subject),
  };
}
