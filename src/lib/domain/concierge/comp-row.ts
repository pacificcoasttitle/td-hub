import type { CompCandidate } from './comp-filter';
import type { NormalizedComp } from './normalize';

/**
 * ─── One definition of a comparable, both directions ────────────────────────
 *
 * THE CLASS OF BUG THIS EXISTS TO END.
 *
 * The document is built twice from two different sources:
 *
 *   generate   payload → normalizeComps → candidates → document
 *   re-render  concierge_profile_comps rows → candidates → document
 *
 * They are supposed to produce the same document. Nothing made them, so any
 * field present in one path and absent from the other diverged silently — and
 * a re-render is the path a reader is most likely to be holding, because
 * "Comparables" re-renders.
 *
 * On 2026-09-23 profile #4 re-rendered onto the v2 template and printed
 * "Comparable 1 … Comparable 4" where its first render printed "1481 BONITA
 * AVE". The address was stored on every row and simply never read back. It had
 * been wrong for as long as it existed and no page showed it, because the v1
 * document never printed comp addresses at all.
 *
 * So the mapping lives here, once, in both directions, and a round-trip test
 * asserts that nothing the document can read is lost in between. The next
 * field the layout starts using is covered before it ships, rather than after
 * a document goes out without it.
 */

/** Everything a comparable carries through to the document. */
export type CompForDocument = CompCandidate & {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  documentNumber: string | null;
  documentType: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * THE FIELD LIST IS THE CONTRACT. The round-trip test iterates this, so adding
 * a field here without carrying it through both mappings fails the build.
 */
export const COMP_DOCUMENT_FIELDS = [
  'sourcePosition', 'salePrice', 'pricePerSqft', 'buildingArea', 'bedrooms',
  'baths', 'yearBuilt', 'lotSize', 'proximityMiles', 'recordingDate',
  'useCodeDescription', 'address', 'city', 'state', 'zip', 'apn',
  'documentNumber', 'documentType', 'latitude', 'longitude',
] as const satisfies readonly (keyof CompForDocument)[];

const numStr = (n: number | null) => (n === null ? null : String(n));
const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** What `normalizeComps` gives us, narrowed to what a row stores. */
type Writable = NormalizedComp;

/**
 * Candidate → row. The numeric columns are drizzle `numeric`, which takes a
 * string; everything else passes through.
 */
export function compRowValues(c: Writable, decision: {
  selected: boolean;
  exclusionReason: string | null;
  displayPosition: number | null;
}, profileId: number) {
  return {
    profileId,
    sourcePosition: c.sourcePosition,
    selected: decision.selected,
    exclusionReason: decision.selected ? null : decision.exclusionReason,
    displayPosition: decision.selected ? decision.displayPosition : null,
    address: c.address, city: c.city, state: c.state, zip: c.zip, apn: c.apn,
    salePrice: numStr(c.salePrice),
    pricePerSqft: numStr(c.pricePerSqft),
    recordingDate: c.recordingDate,
    documentNumber: c.documentNumber, documentType: c.documentType,
    buildingArea: c.buildingArea, bedrooms: c.bedrooms,
    baths: numStr(c.baths),
    yearBuilt: c.yearBuilt, lotSize: c.lotSize,
    useDescription: c.useCodeDescription,
    proximityMiles: numStr(c.proximityMiles),
    latitude: numStr(c.latitude),
    longitude: numStr(c.longitude),
    raw: c.raw,
  };
}

/** The shape a stored row comes back as. Only what this module reads. */
export interface StoredCompRow {
  id?: number;
  sourcePosition: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  salePrice: string | null;
  pricePerSqft: string | null;
  recordingDate: string | null;
  documentNumber: string | null;
  documentType: string | null;
  buildingArea: number | null;
  bedrooms: number | null;
  baths: string | null;
  yearBuilt: number | null;
  lotSize: number | null;
  useDescription: string | null;
  proximityMiles: string | null;
  latitude: string | null;
  longitude: string | null;
}

/** Row → candidate. The inverse of `compRowValues`, and tested as one. */
export function compFromRow(r: StoredCompRow): CompForDocument & { rowId: number } {
  return {
    rowId: r.id ?? 0,
    sourcePosition: r.sourcePosition,
    salePrice: num(r.salePrice),
    pricePerSqft: num(r.pricePerSqft),
    buildingArea: r.buildingArea,
    bedrooms: r.bedrooms,
    baths: num(r.baths),
    yearBuilt: r.yearBuilt,
    lotSize: r.lotSize,
    proximityMiles: num(r.proximityMiles),
    recordingDate: r.recordingDate,
    useCodeDescription: r.useDescription,
    address: r.address,
    city: r.city,
    state: r.state,
    zip: r.zip,
    apn: r.apn,
    documentNumber: r.documentNumber,
    documentType: r.documentType,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
  };
}
