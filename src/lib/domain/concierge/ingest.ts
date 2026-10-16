/**
 * Deriving a profile from a payload we have already paid for. FREE.
 *
 * ─── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 *
 * Three modules, one direction: resolve (generate.ts) buys the payload, ingest
 * derives rows from it, render turns those rows into a document. Nothing here
 * imports the SiteX client, and nothing here can.
 *
 * It was part of generate.ts until the resolve/finalise split, which made
 * generate.ts want "finish what is stored" from retry.ts while retry.ts still
 * wanted ingest from generate.ts — a cycle that ESM tolerates and nobody can
 * reason about later. Moving the derived half out resolves it by direction
 * rather than by luck.
 */
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles, conciergeProfileComps, conciergeProfileTransfers } from '@/lib/db/schema';
import { uploadFile } from '@/lib/integrations/s3/client';
import {
  normalizeComps, normalizePlatMap, normalizeSubject, normalizeTax, normalizeTransfers,
} from './normalize';
import { convertPlatMap } from './platmap';
import { DEFAULT_CRITERIA, selectComps } from './comp-filter';
import { compRowValues } from './comp-row';
import { subjectFactsFromPayload } from './subject-facts';

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
  const decisions = selectComps(comps, subjectFactsFromPayload(subject), DEFAULT_CRITERIA, now);
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
