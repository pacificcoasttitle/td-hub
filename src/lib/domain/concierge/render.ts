import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles, conciergeProfileComps } from '@/lib/db/schema';
import { uploadFile, downloadFile } from '@/lib/integrations/s3/client';
import { DEFAULT_CRITERIA, selectComps, type CompCriteria, type CompCandidate } from './comp-filter';
import { computeMetrics } from './metrics';
import { toDataUri } from './platmap';
import { ProfileDocument, TEMPLATE_VERSION } from './document/profile-document';
import { normalizeSubject, normalizeTax, normalizeTransfers } from './normalize';

// ─── Rendering: the path that CANNOT spend a credit ─────────────────────────
//
// Everything here reads STORED data. There is no SiteX import in this file and
// no network call to a vendor — the only remote reads are of our own S3 objects,
// which we already paid for once.
//
// That is deliberate and structural. Two operator actions land here:
//
//   "move a slider"   -> re-filter the stored comps and re-render
//   "retry the PDF"   -> re-render exactly what was already retrieved
//
// Both must be free, and the way to guarantee free is to make spending
// unreachable from this module rather than to remember not to do it. The
// criteria are OURS: SiteX returns the comparables, we rank and filter them, so
// changing the view is arithmetic on data already bought.
//
// A test asserts this file imports nothing from integrations/sitex.

export interface RenderOutcome {
  ok: boolean;
  profileId: number;
  pdfStorageKey?: string;
  pdfBytes?: number;
  pageCount?: number;
  compsShown?: number;
  message?: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** S3 key for a profile's PDF. Versioned by render so a re-render never overwrites evidence. */
function pdfKey(profileId: number, renderedAt: Date): string {
  return `concierge/${profileId}/profile-${renderedAt.toISOString().replace(/[:.]/g, '-')}.pdf`;
}

/**
 * Re-filter stored comparables and produce a new PDF. NO VENDOR CALL.
 *
 * `criteria` omitted means "render again with whatever was last applied", which
 * is the retry-after-a-failed-render case.
 */
export async function renderProfile(
  profileId: number,
  criteria?: CompCriteria,
  now: Date = new Date(),
): Promise<RenderOutcome> {
  const [profile] = await db.select().from(conciergeProfiles)
    .where(eq(conciergeProfiles.id, profileId)).limit(1);
  if (!profile) return { ok: false, profileId, message: 'Profile not found.' };

  // A profile whose retrieval failed has nothing to render. Re-rendering must
  // never be a way to retry the CALL.
  if (profile.status === 'failed' && !profile.rawStorageKey) {
    return { ok: false, profileId, message: 'This profile has no retrieved data to render. Generating again would spend a credit.' };
  }

  const applied: CompCriteria = criteria ?? {
    sameUseCode: profile.criteriaSameUseCode,
    livingAreaPct: profile.criteriaLivingAreaPct,
    bedDelta: profile.criteriaBedDelta,
    bathDelta: profile.criteriaBathDelta,
    radiusMiles: num(profile.criteriaRadiusMiles),
    months: profile.criteriaMonths,
    maxComps: profile.criteriaMaxComps ?? DEFAULT_CRITERIA.maxComps,
  };

  const storedComps = await db.select().from(conciergeProfileComps)
    .where(eq(conciergeProfileComps.profileId, profileId))
    .orderBy(conciergeProfileComps.sourcePosition);

  const candidates: Array<CompCandidate & { rowId: number }> = storedComps.map((c) => ({
    rowId: c.id,
    sourcePosition: c.sourcePosition,
    salePrice: num(c.salePrice),
    pricePerSqft: num(c.pricePerSqft),
    buildingArea: c.buildingArea,
    bedrooms: c.bedrooms,
    baths: num(c.baths),
    yearBuilt: c.yearBuilt,
    lotSize: c.lotSize,
    proximityMiles: num(c.proximityMiles),
    recordingDate: c.recordingDate,
    useCodeDescription: c.useDescription,
  }));

  const subjectFacts = {
    buildingArea: profile.subjectBuildingArea,
    bedrooms: profile.subjectBeds,
    baths: num(profile.subjectBaths),
    useCodeDescription: profile.subjectUseDescription,
  };

  const filter = selectComps(candidates, subjectFacts, applied, now);
  const metrics = computeMetrics(filter.selected, applied);

  // Images come from OUR storage, not the vendor. A re-render must not refetch
  // the comps map from SiteX's renderer — that URL is time-bound and would give
  // a broken map on an old profile even if it were free.
  const platMapImage = profile.platmapStorageKey ? await loadImage(profile.platmapStorageKey) : null;
  const compMapImage = profile.compMapStorageKey ? await loadImage(profile.compMapStorageKey) : null;

  // Subject, tax and transfers are re-derived from the STORED RAW PAYLOAD
  // rather than from promoted columns.
  //
  // The promoted subject_* columns exist to be queryable; they deliberately do
  // not cover everything the document prints — owner name, site address, legal
  // description and the lot-size label are not among them. Re-normalising the
  // payload keeps ONE source of truth and means a re-render always reflects
  // exactly what SiteX sent, with no risk of a column drifting from it. That is
  // what raw_storage_key is for.
  if (!profile.rawStorageKey) {
    return { ok: false, profileId, message: 'The stored payload is missing, so this profile cannot be re-rendered.' };
  }
  const rawObj = await downloadFile(profile.rawStorageKey);
  if (!rawObj.success || !rawObj.data) {
    return { ok: false, profileId, message: 'The stored payload could not be read, so this profile cannot be re-rendered.' };
  }
  const feed = (JSON.parse(rawObj.data.toString('utf8')) as { Feed?: Record<string, unknown> }).Feed ?? {};
  const subject = normalizeSubject(feed);
  const tax = normalizeTax(feed);
  const transfers = normalizeTransfers(feed);

  const { renderToBuffer } = await import('@react-pdf/renderer');
  const buf = await renderToBuffer(ProfileDocument({
    subject, tax,
    transfers,
    filter, metrics, criteria: applied,
    compMapImage, platMapImage,
    platMapStatus: profile.platmapStatus,
    preparedFor: {
      name: profile.preparedForName ?? '',
      company: profile.preparedForCompany ?? null,
    },
    presentingRep: {
      name: profile.presentingRepName ?? '',
      email: profile.presentingRepEmail,
      phone: profile.presentingRepPhone,
      title: profile.presentingRepTitle,
    },
    generatedAt: now,
  }));

  const key = pdfKey(profileId, now);
  const up = await uploadFile({ key, buffer: buf, contentType: 'application/pdf' });
  if (!up.success) {
    await db.update(conciergeProfiles)
      .set({ status: 'failed', errorMessage: `PDF stored nowhere: ${up.error?.message ?? 'upload failed'}` })
      .where(eq(conciergeProfiles.id, profileId));
    return { ok: false, profileId, message: 'The document rendered but could not be stored.' };
  }

  const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  await db.update(conciergeProfiles).set({
    criteriaSameUseCode: applied.sameUseCode,
    criteriaLivingAreaPct: applied.livingAreaPct,
    criteriaBedDelta: applied.bedDelta,
    criteriaBathDelta: applied.bathDelta,
    criteriaRadiusMiles: applied.radiusMiles === null ? null : String(applied.radiusMiles),
    criteriaMonths: applied.months,
    criteriaMaxComps: applied.maxComps,
    compsQualified: filter.counts.qualified,
    compsShown: filter.counts.shown,
    metrics: metrics as unknown as Record<string, unknown>,
    templateVersion: TEMPLATE_VERSION,
    pdfStorageKey: key,
    pdfSha256: crypto.createHash('sha256').update(buf).digest('hex'),
    pdfBytes: buf.length,
    pdfPageCount: pageCount,
    status: 'generated',
    errorMessage: null,
  }).where(eq(conciergeProfiles.id, profileId));

  // The stored comps carry the decision that produced THIS pdf, so a challenged
  // comparable can be defended against the document that was actually sent.
  const byPosition = new Map(filter.decisions.map((d) => [d.candidate.sourcePosition, d]));
  for (const c of candidates) {
    const d = byPosition.get(c.sourcePosition);
    await db.update(conciergeProfileComps).set({
      selected: d?.selected ?? false,
      exclusionReason: d?.exclusionReason ?? null,
      displayPosition: d?.displayPosition ?? null,
    }).where(and(
      eq(conciergeProfileComps.id, c.rowId),
      eq(conciergeProfileComps.profileId, profileId),
    ));
  }

  return { ok: true, profileId, pdfStorageKey: key, pdfBytes: buf.length, pageCount, compsShown: filter.counts.shown };
}

async function loadImage(key: string): Promise<string | null> {
  const r = await downloadFile(key);
  if (!r.success || !r.data) return null;
  return toDataUri(r.data);
}
