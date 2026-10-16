import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema';
import { downloadFile, uploadFile } from '@/lib/integrations/s3/client';
import {
  fetchConciergeProfile, getConciergeFeedId, guardMessage, type MatchCandidate,
} from '@/lib/integrations/sitex/concierge-feed';
import { normalizeSubject } from './normalize';
import { DEFAULT_CRITERIA, type CompCriteria } from './comp-filter';
import { criteriaSummary, profileListSubject } from './list-line';
import { claimProperty, propertyRequestKey, recordClaimOutcome, releaseClaim } from './claim';
import {
  alreadyHaveMessage, findProfileForProperty, findResolvedForProperty, type ExistingProfile,
} from './already-have';
import { TEMPLATE_VERSION } from './document/profile-document';
import { NO_PAYLOAD_MESSAGE, resumeFromStored } from './retry';

/**
 * Re-exported, not re-implemented: it moved to ingest.ts when the resolve and
 * finalise halves were split apart, and every existing caller asks generate.ts
 * for it. The direction of the dependency is generate → ingest, never back.
 */
export { ingestPayload } from './ingest';

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

/** The gate: everything collected AFTER the property is known, none of it billable. */
export interface FinaliseInput {
  preparedForName: string;
  preparedForCompany?: string | null;
  preparedForEmail?: string | null;
  presentingRep: {
    name: string;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
  };
  criteria?: CompCriteria;
}

export type FinaliseOutcome =
  | { ok: true; profileId: number; compsShown: number }
  | {
    ok: false; profileId: number; message: string;
    /** Already a document. Not an error worth a red banner — open it. */
    alreadyGenerated?: boolean;
  };

/**
 * Both halves at once, for the single-shot path.
 *
 * Still used by the orders flow, where the property is already known from the
 * order and there is no gate to fill in, and by every test that asserts the
 * whole sequence. The Reports modal resolves and finalises separately.
 */
export type GenerateInput = PropertyLookup & FinaliseInput;

export type GenerateOutcome =
  | { ok: true; profileId: number; creditsCharged: number; compsShown: number }
  | {
    ok: false; profileId: number | null; creditsCharged: number; message: string;
    /**
     * The parcels to choose between, when the address matched more than one.
     * The caller shows these and resends with `apn`/`fips`; without them the
     * refusal names a problem the operator cannot act on.
     */
    candidates?: MatchCandidate[];
  }
  /**
   * A request within the claim window already generated (or is generating) this
   * property. Nothing was spent; the caller shows that profile instead.
   */
  | { ok: false; duplicate: true; profileId: number | null; creditsCharged: 0; message: string }
  /**
   * We already hold a profile for this property, generated outside the claim
   * window. Nothing was spent; the caller offers the choice.
   */
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

/**
 * Turn a resolution into a document. FREE, and it cannot reach the vendor —
 * nothing below this line imports the SiteX client.
 *
 * Takes the gate the operator filled in after seeing the property, writes it
 * to the row, then does exactly what `resumeFromStored` does: ingest the stored
 * payload and render. That is not a coincidence — a resolution awaiting its
 * gate and a generation that died after the upload are the same row in the same
 * state, so they are finished by the same code.
 */
export async function finaliseProfile(
  profileId: number,
  gate: FinaliseInput,
): Promise<FinaliseOutcome> {
  const [profile] = await db.select({
    id: conciergeProfiles.id,
    status: conciergeProfiles.status,
    rawStorageKey: conciergeProfiles.rawStorageKey,
    pdfStorageKey: conciergeProfiles.pdfStorageKey,
  }).from(conciergeProfiles).where(eq(conciergeProfiles.id, profileId)).limit(1);

  if (!profile) return { ok: false, profileId, message: 'Profile not found.' };

  // Already a document. Not an error — the second operator in the window, or a
  // double-click on Generate. Say so and let the caller open it.
  if (profile.pdfStorageKey) {
    return {
      ok: false, profileId, alreadyGenerated: true,
      message: 'This property has already been generated. Opening that document — nothing was charged.',
    };
  }

  // THE LINE BETWEEN FINISHING AND BUYING IT AGAIN. A row with no stored
  // payload cannot be finalised, and finalise has no way to go and get one.
  if (!profile.rawStorageKey) {
    return { ok: false, profileId, message: NO_PAYLOAD_MESSAGE };
  }

  const criteria = gate.criteria ?? DEFAULT_CRITERIA;

  // The gate, onto the row, BEFORE the render reads it. The document prints
  // these names; a render that ran first would print nulls.
  await db.update(conciergeProfiles).set({
    preparedForName: gate.preparedForName,
    preparedForCompany: gate.preparedForCompany ?? null,
    preparedForEmail: gate.preparedForEmail ?? null,
    presentingRepName: gate.presentingRep.name,
    presentingRepEmail: gate.presentingRep.email ?? null,
    presentingRepPhone: gate.presentingRep.phone ?? null,
    presentingRepTitle: gate.presentingRep.title ?? null,
    criteriaSameUseCode: criteria.sameUseCode,
    criteriaLivingAreaPct: criteria.livingAreaPct,
    criteriaBedDelta: criteria.bedDelta,
    criteriaBathDelta: criteria.bathDelta,
    criteriaRadiusMiles: criteria.radiusMiles === null ? null : String(criteria.radiusMiles),
    criteriaMonths: criteria.months,
    criteriaMaxComps: criteria.maxComps,
    listSettings: criteriaSummary(criteria),
  }).where(eq(conciergeProfiles.id, profileId));

  // Shared with `resume` and the Reports list's "Try again", which is the point:
  // one implementation of "finish what is stored", exercised by three callers.
  const finished = await resumeFromStored(profileId, criteria);
  if (!finished.ok) {
    return { ok: false, profileId, message: finished.message };
  }

  const [done] = await db.select({ compsShown: conciergeProfiles.compsShown })
    .from(conciergeProfiles).where(eq(conciergeProfiles.id, profileId)).limit(1);
  return { ok: true, profileId, compsShown: done?.compsShown ?? 0 };
}

/**
 * Resolve and finalise in one call.
 *
 * The orders flow's entry point, where the property comes off the order and
 * there is no gate to put in front of anyone. The Reports modal calls the two
 * halves separately so the operator sees the property before committing.
 */
export async function generateConciergeProfile(input: GenerateInput): Promise<GenerateOutcome> {
  const resolved = await resolveProperty(input);
  if (!resolved.ok) return resolved;

  const { profileId, creditsCharged } = resolved.resolved;
  const finished = await finaliseProfile(profileId, input);
  if (!finished.ok) {
    return {
      ok: false, profileId, creditsCharged,
      message: finished.alreadyGenerated
        ? finished.message
        : `${finished.message} The property data is stored, so finishing it again costs nothing.`,
    };
  }
  return { ok: true, profileId, creditsCharged, compsShown: finished.compsShown };
}


