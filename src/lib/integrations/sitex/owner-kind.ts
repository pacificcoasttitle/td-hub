import type { OwnerKind } from '@/lib/domain/orders/names/sitex-owner-names';

// ─── Is the current owner a person or an organization? ──────────────────────
//
// SiteX does not say so on the field we read. PropertyProfile carries exactly
// two owner fields, PrimaryOwnerName and OwnerPhoneNum, and neither has a type.
// Verified against the feed schema and two real production payloads.
//
// It DOES say so in TransferHistory, which the same response already contains
// and which we discarded entirely until now. Every deed party is shaped:
//
//   { LastOrCorporateName, FirstAndMiddleName, EntityCode, EntityCodeDesc }
//
// and FirstAndMiddleName is ABSENT — the key, not an empty string — for an
// organization, present for a person. Measured across all 74 party objects in
// an entity-owned payload: 74 agree, 0 disagree.
//
//   Buyer  { LastOrCorporateName: "5558 RIVERTON LLC", EntityCode: "LC" }
//          -- no FirstAndMiddleName
//   Seller { LastOrCorporateName: "KAO", FirstAndMiddleName: "DENNIS",
//            EntityCode: "HW" }
//
// EntityCode is NOT used as the discriminator, despite the name. Its domain
// mixes entity types (LC, CO) with marital and survivorship status (HW, SM, SW,
// ID, TS), and AK — "a/k/a" — appears on BOTH an entity and a person in the same
// payload. One party carried no EntityCode at all. FirstAndMiddleName was right
// in all three of those cases; EntityCode was not. It is carried through as
// corroboration only.

/** Loose shapes — SiteX omits keys freely, so nothing here may assume presence. */
interface RawParty {
  LastOrCorporateName?: string | null;
  FirstAndMiddleName?: string | null;
  EntityCode?: string | null;
  EntityCodeDesc?: string | null;
}

interface RawTransfer {
  CurrentOwnerFlag?: string | boolean | null;
  Deed?: { BuyerInfo?: { Buyers?: { Buyer?: RawParty[] | RawParty } } } | null;
}

export interface OwnerKindEvidence {
  kind: OwnerKind;
  /** The deed party we read it from, when there was one. */
  lastOrCorporateName: string | null;
  entityCode: string | null;
  entityCodeDesc: string | null;
  /** Why the answer is what it is — recorded so 'unknown' is explainable. */
  reason:
    | 'no-transfer-history'
    | 'no-current-owner-deed'
    | 'no-buyer-party'
    | 'first-and-middle-name-absent'
    | 'first-and-middle-name-present';
}

const UNKNOWN = (reason: OwnerKindEvidence['reason']): OwnerKindEvidence => ({
  kind: 'unknown', lastOrCorporateName: null, entityCode: null, entityCodeDesc: null, reason,
});

/** SiteX writes this as the string "True", not a boolean. Accept both. */
function isCurrentOwner(v: unknown): boolean {
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

function asArray(v: RawParty[] | RawParty | undefined | null): RawParty[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Read the current owner's kind out of a raw SiteX search response.
 *
 * Returns 'unknown' whenever the evidence is not there, and says which kind of
 * absence it was. 'unknown' is a normal outcome, not a failure: the caller falls
 * back to the entity-marker list, which may only abstain.
 */
export function deriveOwnerKind(raw: unknown): OwnerKindEvidence {
  const feed = (raw as { Feed?: { TransferHistory?: unknown } } | null)?.Feed;
  const history = feed?.TransferHistory;
  if (!Array.isArray(history) || history.length === 0) return UNKNOWN('no-transfer-history');

  // Several entries can carry CurrentOwnerFlag; only one tends to hold the Deed
  // that names the buyers. Measured on a real property: 3 flagged, 1 with a Deed.
  const deedEntry = (history as RawTransfer[]).find(
    (t) => isCurrentOwner(t?.CurrentOwnerFlag) && t?.Deed?.BuyerInfo?.Buyers?.Buyer,
  );
  if (!deedEntry) return UNKNOWN('no-current-owner-deed');

  const buyers = asArray(deedEntry.Deed!.BuyerInfo!.Buyers!.Buyer);
  const first = buyers[0];
  if (!first) return UNKNOWN('no-buyer-party');

  // THE DISCRIMINATOR: the KEY's presence, not its value. An organization's
  // party object omits FirstAndMiddleName entirely.
  const hasGivenName = Object.prototype.hasOwnProperty.call(first, 'FirstAndMiddleName')
    && typeof first.FirstAndMiddleName === 'string'
    && first.FirstAndMiddleName.trim() !== '';

  return {
    kind: hasGivenName ? 'person' : 'entity',
    lastOrCorporateName: first.LastOrCorporateName?.trim() || null,
    entityCode: first.EntityCode?.trim() || null,
    entityCodeDesc: first.EntityCodeDesc?.trim() || null,
    reason: hasGivenName ? 'first-and-middle-name-present' : 'first-and-middle-name-absent',
  };
}
