// ─── Confirmation outranks every parser ──────────────────────────────────────
//
// INVARIANT, not a convention. A value a named human confirmed — they typed it,
// or they left a prefilled value untouched and submitted — must survive SoftPro
// sync, SiteX parse, lookback, enrich, and merge. We spent a week finding
// places derived data quietly replaced better data. This is the field where we
// have a human's own word.
//
// The latch is per-field on a confirmed row:
//   - party_confirmed_at set AND the field is non-empty → frozen
//   - party_confirmed_at set AND the field is empty → parsers may fill it
//   - party_confirmed_at null → existing per-field non-empty merge
//
// Confirming name but newly collecting email freezes the name; a later SoftPro
// write cannot clobber it. The collected email is also written by the wizard
// and is then non-empty, so it freezes too. Leaving a prefilled name untouched
// and submitting confirms that name forever against parsers.
//
// The wizard itself is the confirmation path and does not go through this
// function — a later submit may correct what they confirmed earlier.
//
// order_parties.source is write-origin and is null everywhere. Do not reuse it.
//
// Every writer that updates name / email / phone / company on order_parties
// must call protectConfirmedPartyFields. Today that is:
//   - enrich-orders upsertResolvedParty   (SoftPro GetOrderContacts / enrich)
//   - verify-order-sync reconcileParties  (SoftPro read-back)
// SiteX create-order writes parties only on INSERT of a new order (no row to
// clobber). lookback-sync / process-detail do not write order_parties identity
// fields. If either starts to, they come through this function first.

export const PARTY_IDENTITY_FIELDS = [
  'externalName',
  'externalCompany',
  'externalEmail',
  'externalPhone',
] as const;

export type PartyIdentityField = (typeof PARTY_IDENTITY_FIELDS)[number];

export type PartyIdentityPatch = Partial<Record<PartyIdentityField, string | null | undefined>>;

export interface ConfirmedPartySnapshot extends PartyIdentityPatch {
  partyConfirmedAt?: Date | string | null;
}

export function isPresentPartyValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isPartyConfirmed(row: ConfirmedPartySnapshot | null | undefined): boolean {
  return row?.partyConfirmedAt != null && row.partyConfirmedAt !== '';
}

/**
 * Drop any proposed overwrite of a confirmed, already-populated field.
 *
 * Callers still apply their own "skip empty incoming" rule before or after;
 * this function only enforces the latch.
 */
export function protectConfirmedPartyFields<T extends PartyIdentityPatch>(
  existing: ConfirmedPartySnapshot | null | undefined,
  proposed: T,
): T {
  if (!isPartyConfirmed(existing)) return proposed;

  const out = { ...proposed };
  for (const field of PARTY_IDENTITY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(out, field)) continue;
    if (isPresentPartyValue(existing?.[field])) {
      delete out[field];
    }
  }
  return out;
}

/** Form keys the listing-agent submit snapshots. Seller keys ride on the same payload. */
export const LISTING_AGENT_SNAPSHOT_KEYS = [
  'agentName',
  'agentEmail',
  'agentPhone',
  'agentCompany',
  'sellerName',
  'sellerEmail',
  'sellerPhone',
] as const;

export type ListingAgentSnapshotKey = (typeof LISTING_AGENT_SNAPSHOT_KEYS)[number];

export function changedFormKeys(
  prefilled: Record<string, string>,
  submitted: Record<string, unknown>,
  keys: readonly string[] = LISTING_AGENT_SNAPSHOT_KEYS,
): string[] {
  return keys.filter((key) => {
    const before = (prefilled[key] ?? '').trim();
    const after = typeof submitted[key] === 'string' ? submitted[key].trim() : '';
    return before !== after;
  });
}

export function submissionSnapshot(
  prefilled: Record<string, string>,
  submitted: Record<string, unknown>,
): { prefilledValues: Record<string, string>; changedKeys: string[] } {
  return {
    prefilledValues: prefilled,
    changedKeys: changedFormKeys(prefilled, submitted),
  };
}
