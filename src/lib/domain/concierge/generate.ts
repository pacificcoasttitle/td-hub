/**
 * Finalise: turning a resolution into a document, and the single-shot path.
 *
 * ─── NOTHING HERE CAN SPEND ─────────────────────────────────────────────────
 *
 * The SiteX call lives in resolve.ts, which this module calls and never
 * reimplements. `generateConciergeProfile` is resolve-then-finalise, so "the
 * same call" is true by construction rather than by two functions happening to
 * agree — and routes.test.ts asserts that resolve.ts holds the only call site
 * in the codebase.
 *
 * A profile with no stored payload is REFUSED rather than re-fetched. That
 * refusal is the line between finishing and buying it again.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { conciergeProfiles } from '@/lib/db/schema';
import { DEFAULT_CRITERIA, type CompCriteria } from './comp-filter';
import { criteriaSummary } from './list-line';
import type { ExistingProfile } from './already-have';
import { NO_PAYLOAD_MESSAGE, resumeFromStored } from './retry';
import { resolveProperty, type PropertyLookup, type ResolveOutcome } from './resolve';
// From the feed client, where it is defined. resolve.ts imports it from the
// same place rather than re-exporting it — one definition, one source.
import type { MatchCandidate } from '@/lib/integrations/sitex/concierge-feed';

/**
 * Re-exported so the two halves can be reached from one import where that is
 * genuinely convenient — the orders route, and tests that drive the whole
 * sequence. The DIRECTION is what matters: generate → resolve → ingest, never
 * back.
 */
export { resolveProperty } from './resolve';
export type { PropertyLookup, ResolvedProperty, ResolveOutcome } from './resolve';
export { ingestPayload } from './ingest';


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


