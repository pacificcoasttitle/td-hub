import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles, conciergeProfileComps, conciergeProfileTransfers } from '@/lib/db/schema';
import { uploadFile } from '@/lib/integrations/s3/client';
import {
  fetchConciergeProfile, getConciergeFeedId, guardMessage,
} from '@/lib/integrations/sitex/concierge-feed';
import {
  normalizeComps, normalizePlatMap, normalizeSubject, normalizeTax, normalizeTransfers,
} from './normalize';
import { convertPlatMap } from './platmap';
import { DEFAULT_CRITERIA, selectComps } from './comp-filter';
import { criteriaSummary, profileListSubject } from './list-line';
import { claimProperty, propertyRequestKey, recordClaimOutcome, releaseClaim } from './claim';
import { alreadyHaveMessage, findProfileForProperty, type ExistingProfile } from './already-have';
import { TEMPLATE_VERSION } from './document/profile-document';
import { compRowValues } from './comp-row';
import { renderProfile } from './render';

// ─── Generation: the ONLY path that spends a credit ─────────────────────────
//
// Exactly one SiteX call, made once, guarded before it is trusted. Everything
// the call returned is stored before anything is computed from it, so no later
// operation ever needs to buy it again — which is what makes the render path
// free and unlimited.
//
// Order of operations is deliberate:
//   1. row first, status 'pending'      so a crash leaves a record, not a gap
//   2. the call
//   3. guard — a failure stores the evidence and produces NO document
//   4. raw payload to storage BEFORE parsing
//   5. comps, transfers, maps — EACH COMP ROW WRITTEN ALREADY DECIDED
//   6. render, which is a separate module that cannot call the vendor

export interface GenerateInput {
  orderId?: number | null;
  street: string;
  city: string;
  state: string;
  zip: string;
  preparedForName: string;
  preparedForCompany?: string | null;
  preparedForEmail?: string | null;
  presentingRep: {
    name: string;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
  };
  createdBy?: string | null;
  /**
   * The operator was shown the profile we already hold for this property and
   * asked for a fresh one anyway. Absent, an existing profile stops the spend
   * and is returned instead.
   */
  allowDuplicate?: boolean;
}

export type GenerateOutcome =
  | { ok: true; profileId: number; creditsCharged: number; compsShown: number }
  | { ok: false; profileId: number | null; creditsCharged: number; message: string }
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

export async function generateConciergeProfile(input: GenerateInput): Promise<GenerateOutcome> {
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
  }

  // 0b. THE RACE GUARD. Two clicks a second apart both read nothing above; this
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
    preparedForName: input.preparedForName,
    preparedForCompany: input.preparedForCompany ?? null,
    preparedForEmail: input.preparedForEmail ?? null,
    presentingRepName: input.presentingRep.name,
    presentingRepEmail: input.presentingRep.email ?? null,
    presentingRepPhone: input.presentingRep.phone ?? null,
    presentingRepTitle: input.presentingRep.title ?? null,
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
    street: input.street, city: input.city, state: input.state, zip: input.zip,
  });

  const guardCols = {
    sitexRequestedAt: requestedAt,
    sitexDurationMs: result.durationMs,
    sitexCreditsCharged: result.creditsCharged,
    isValidAddress: result.guard?.isValidAddress ?? null,
    outsideCoverage: result.guard?.outsideCoverage ?? null,
    locationCount: result.guard?.locationCount ?? null,
    matchMethodCode: result.guard?.matchMethodCode ?? null,
    sitexSearchId: result.guard?.searchId ?? null,
  };

  // 3. A guard failure is recorded WITH its evidence and produces no document.
  //    The credits actually charged are stored either way, so a refused
  //    generation that still cost money is visible in the metering.
  if (!result.ok) {
    const message = result.reason === 'not_configured' || result.reason === 'api_error' || result.reason === 'network'
      ? result.message
      : guardMessage(result.reason);
    await db.update(conciergeProfiles)
      .set({ ...guardCols, status: 'failed', errorMessage: message })
      .where(eq(conciergeProfiles.id, profileId));
    // Nothing spent — give the property back, so a corrected retry is not
    // locked out for the window. If it DID charge, the claim stands: the credit
    // is gone and a second click must not spend another.
    if (result.creditsCharged === 0) await releaseClaim(requestKey);
    else await recordClaimOutcome(requestKey, profileId, null);
    return { ok: false, profileId, creditsCharged: result.creditsCharged, message };
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

  const { apn } = await ingestPayload(profileId, result.payload);

  // The property this address turned out to be. Evidence on the claim, not the
  // pre-spend key — the APN does not exist until the call has been paid for.
  await recordClaimOutcome(requestKey, profileId, apn);

  // 6. Render. Separate module, no vendor access — see render.ts.
  const rendered = await renderProfile(profileId, DEFAULT_CRITERIA);
  if (!rendered.ok) {
    return {
      ok: false, profileId, creditsCharged: result.creditsCharged,
      message: `${rendered.message ?? 'The document could not be produced.'} The property data is stored, so retrying the render costs nothing.`,
    };
  }

  return { ok: true, profileId, creditsCharged: result.creditsCharged, compsShown: rendered.compsShown ?? 0 };
}


/**
 * Everything that happens to a payload we have already paid for.
 *
 * SEPARATE FROM THE CALL ON PURPOSE. The raw response is in storage before this
 * runs, so a profile whose ingest failed can be completed from what is stored —
 * without going back to the vendor and without spending a second credit. That
 * is what raw_storage_key was always for; nothing exercised it until profile 3.
 *
 * ─── THE FILTER RUNS BEFORE THE WRITE ───────────────────────────────────────
 *
 * Every comp row is inserted ALREADY DECIDED: selected with a display position,
 * or excluded with the rule that rejected it. The check constraint
 * `concierge_comps_exclusion_shape` requires exactly that, and it is the reason
 * the stored set can explain itself months later — every comparable either
 * appears at a position or carries why it does not.
 *
 * Writing candidates undecided and filtering afterwards is what failed on the
 * first real generation: `selected = false, exclusion_reason = NULL` is a third
 * state the schema does not allow, and it should not — it is a row that means
 * nothing. selectComps is pure and takes no I/O, so there is no reason to write
 * first and decide second.
 */
export async function ingestPayload(
  profileId: number,
  /** The parsed SiteX response — from the call, or from stored raw on a resume. */
  payload: { Feed?: Record<string, unknown> },
  now: Date = new Date(),
): Promise<{ apn: string | null; compsReturned: number }> {
  const feed = (payload.Feed ?? {}) as Record<string, unknown>;
  const subject = normalizeSubject(feed);
  const tax = normalizeTax(feed);
  const comps = normalizeComps(feed);
  const transfers = normalizeTransfers(feed);
  const platmapRaw = normalizePlatMap(feed);

  // 5a. Decide, then write. The render step re-runs this whenever the criteria
  //     move; these are the decisions the FIRST document was built from.
  const decisions = selectComps(comps, {
    buildingArea: subject.buildingArea,
    bedrooms: subject.beds,
    baths: subject.baths,
    useCodeDescription: subject.useDescription,
  }, DEFAULT_CRITERIA, now);
  const byPosition = new Map(decisions.decisions.map((d) => [d.candidate.sourcePosition, d]));

  if (comps.length > 0) {
    await db.insert(conciergeProfileComps).values(comps.map((c) => {
      // One decision per candidate, so this cannot miss. If it ever does, stop:
      // the row would have to be written undecided, and an undecided row is the
      // thing the constraint exists to refuse. The payload is already stored,
      // so the profile is resumable rather than lost.
      const d = byPosition.get(c.sourcePosition);
      if (!d) throw new Error(`Comparable ${c.sourcePosition} came back without a decision.`);
      // ONE MAPPING, BOTH DIRECTIONS (comp-row.ts). The inverse is what the
      // re-render path reads, and a round-trip test holds them together — a
      // field written here and not read back there is how a re-rendered
      // profile printed "Comparable 1" instead of an address.
      return compRowValues(c, d, profileId);
    }));
  }

  if (transfers.length > 0) {
    await db.insert(conciergeProfileTransfers).values(transfers.map((t) => ({
      profileId,
      sourcePosition: t.sourcePosition,
      transactionType: t.transactionType, documentType: t.documentType,
      recordingDate: t.recordingDate, contractDate: t.contractDate,
      documentNumber: t.documentNumber, bookNumber: t.bookNumber, pageNumber: t.pageNumber,
      currentOwnerFlag: t.currentOwnerFlag, isForeclosure: t.isForeclosure,
      raw: t.raw,
    })));
  }

  // 5b. Maps are SNAPSHOTTED, not linked. SiteX's map URL is time-bound, so a
  //     profile re-rendered in three years would otherwise show a broken image.
  const platmapCols = await storePlatMap(profileId, platmapRaw);
  const compMapCols = await storeCompMap(profileId, feed);

  await db.update(conciergeProfiles).set({
    ...platmapCols, ...compMapCols,
    subjectApn: subject.apn, subjectFips: subject.fips, subjectCounty: subject.county,
    subjectUseCode: subject.useCode, subjectUseDescription: subject.useDescription,
    subjectBeds: subject.beds,
    subjectBaths: subject.baths === null ? null : String(subject.baths),
    subjectBuildingArea: subject.buildingArea, subjectLotSize: subject.lotSize,
    subjectYearBuilt: subject.yearBuilt,
    subjectLatitude: subject.latitude === null ? null : String(subject.latitude),
    subjectLongitude: subject.longitude === null ? null : String(subject.longitude),
    subjectLastSaleDate: subject.lastSaleDate,
    subjectLastSalePrice: subject.lastSalePrice === null ? null : String(subject.lastSalePrice),
    taxYear: tax.year,
    taxAssessedValue: tax.assessedValue === null ? null : String(tax.assessedValue),
    taxLandValue: tax.landValue === null ? null : String(tax.landValue),
    taxImprovementValue: tax.improvementValue === null ? null : String(tax.improvementValue),
    taxMarketValue: tax.marketValue === null ? null : String(tax.marketValue),
    taxAmount: tax.taxAmount === null ? null : String(tax.taxAmount),
    taxStatus: tax.status,
    compsReturned: comps.length,
  }).where(eq(conciergeProfiles.id, profileId));

  return { apn: subject.apn ?? null, compsReturned: comps.length };
}

async function storePlatMap(profileId: number, raw: ReturnType<typeof normalizePlatMap>) {
  if (!raw) return { platmapFilename: null, platmapStatus: null };
  const converted = await convertPlatMap(raw);
  if (!converted.ok) {
    // The absence and its reason are recorded; the document renders the gap.
    return { platmapFilename: raw.filename, platmapStatus: raw.status ?? converted.reason };
  }
  const key = `concierge/${profileId}/platmap.png`;
  const up = await uploadFile({ key, buffer: converted.png, contentType: 'image/png' });
  return {
    platmapFilename: raw.filename,
    platmapStatus: raw.status,
    platmapStorageKey: up.success ? key : null,
    platmapSha256: crypto.createHash('sha256').update(converted.png).digest('hex'),
  };
}

async function storeCompMap(profileId: number, feed: Record<string, unknown>) {
  const url = typeof feed.PropertyMapURL === 'string' ? feed.PropertyMapURL : null;
  if (!url) return { compMapUrl: null };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { compMapUrl: url };
    const buf = Buffer.from(await res.arrayBuffer());
    const key = `concierge/${profileId}/comp-map.png`;
    const up = await uploadFile({ key, buffer: buf, contentType: 'image/png' });
    return {
      compMapUrl: url,
      compMapStorageKey: up.success ? key : null,
      compMapSha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
  } catch {
    // A map we could not fetch is a gap on the page, not a failed profile.
    return { compMapUrl: url };
  }
}
