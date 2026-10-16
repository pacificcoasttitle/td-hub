'use client';

import { useEffect, useState } from 'react';
import { ModalShell } from '@/components/shared/action-modals/modal-shell';
import { AddressAutocomplete, type ParsedAddress } from '@/components/ui/address-autocomplete';
import { RepCombobox } from './rep-combobox';
import { ConciergeCostGate } from '@/components/hub/split/concierge-cost-gate';
import { CriteriaFields } from '@/components/hub/split/concierge-criteria-panel';
import { criteriaSummary } from '@/lib/domain/concierge/list-line';
import { DEFAULT_CRITERIA, type CompCriteria } from '@/lib/domain/concierge/comp-filter';
import type { ReportType } from '@/lib/domain/reports/list-types';
import {
  FarmingStep, emptyFarmingDraft, farmingFormData, farmingProblem, isFarming, type FarmingDraft,
} from './farming-step';
// A PURE DATA TABLE — fips.ts has no imports of its own, so it carries nothing
// server-side into the browser bundle. Checked rather than assumed: a client
// component dragging @react-pdf in is how a deploy broke on 2026-09-30.
import { CALIFORNIA_COUNTIES } from '@/lib/integrations/titlepoint/fips';

// ─── New Report ─────────────────────────────────────────────────────────────
//
// FOUR TYPES. Concierge Profile spends a credit and goes through the cost
// gate. The three farming types spend nothing: a file, a few choices and a rep,
// then POST /api/reports/farming, which calls the generator and passes its
// refusals back word for word ("The file has no column for: purchase price").
//
// Concierge is also the only type that spends money, and the money is spent by
// exactly one route: POST /api/concierge/profiles. This file does not decide
// whether it may — /api/concierge/access does, on the server, and the route
// re-checks. Greying a card is not a permission model.
//
// THE PRESENTING REP IS PICKED, NEVER ASSUMED. From an order the server reads
// the order's sales rep; there is no order here, and the operator clicking
// Generate is usually open_order_team, not the rep whose name and phone the
// document prints. Defaulting to the signed-in user would put the wrong person
// on a client-facing page, so the pick is required.

export interface TypeOption {
  type: ReportType;
  label: string;
  blurb: string;
  /** Selectable right now. */
  available: boolean;
  /** Why not, when it is not. Shown on the card. */
  unavailableNote: string | null;
  /** Concierge only. */
  costNote: string | null;
}

export interface ConciergeAccess {
  canGenerate: boolean;
  featureOn: boolean;
  /**
   * Whether a MyNHD call would be refused before leaving this deploy.
   *
   * Optional because an older cached response will not carry it, and a missing
   * field must read as "not available" rather than crash — the control hides,
   * which is the safe direction.
   */
  hazardAvailable?: boolean;
}

/**
 * The cards, and which of them can be clicked. Access is the SERVER's answer,
 * so a flag that is off produces a card that says so rather than a button that
 * fails at the vendor.
 *
 * `farming` is the server's answer for the three farming reports: null while it
 * is being asked, then whether this role may create them. They cost nothing, so
 * no flag governs them — only the role.
 */
export function typeOptions(access: ConciergeAccess | null, farming: boolean | null = null): TypeOption[] {
  const farmingNote = farming === null
    ? 'Checking…'
    : farming ? null : 'You do not have permission to create farming reports.';

  const conciergeNote = access === null
    ? 'Checking…'
    : !access.featureOn
      ? 'Property profiles are not enabled.'
      : !access.canGenerate
        ? 'You do not have permission to generate property profiles.'
        : null;

  return [
    {
      type: 'concierge_profile',
      label: 'Concierge Profile',
      blurb: 'One property: owner, tax, sales history and comparables.',
      available: conciergeNote === null,
      unavailableNote: conciergeNote,
      // No cost pill (Gerard, 2026-09-23). The type card says what the report
      // IS; what it costs is the company's concern, not the operator's.
      costNote: null,
    },
    {
      type: 'sales_activity',
      label: 'Sales Activity',
      blurb: 'One area over 3, 6 or 12 months: median prices, month by month. Needs a CSV.',
      available: farmingNote === null, unavailableNote: farmingNote, costNote: null,
    },
    {
      type: 'carrier_route',
      label: 'Carrier Route Analysis',
      blurb: 'The top ten postal carrier routes in an area, ranked by the measure you choose. Needs a CSV.',
      available: farmingNote === null, unavailableNote: farmingNote, costNote: null,
    },
    {
      type: 'county_sales',
      label: 'County Sales',
      blurb: 'A county month, city by city: houses and condominiums. Needs a CSV.',
      available: farmingNote === null, unavailableNote: farmingNote, costNote: null,
    },
  ];
}

/**
 * How the operator is identifying the property.
 *
 * 'address' is Google autocomplete and is the default. 'apn' is the parcel,
 * which the order-creation flow has always had and this one did not — and
 * which is also the escape hatch when SiteX will not resolve an address: a
 * parcel search CANNOT multi-match.
 */
export type PropertyMode = 'address' | 'apn';

export interface ConciergeDraft {
  mode: PropertyMode;
  street: string;
  city: string;
  state: string;
  zip: string;
  /** Parcel number, as the county writes it. Formats differ by county. */
  apn: string;
  /** The county's five-digit FIPS, chosen from CALIFORNIA_COUNTIES. */
  fips: string;
  repContactId: number | null;
  repName: string;
}

/**
 * What is still missing, in the words the operator needs. Returned rather than
 * thrown so the button can be disabled AND the reason shown — a disabled button
 * with no explanation is a dead end.
 */
/**
 * What is still missing BEFORE THE LOOKUP, which is the step that spends.
 *
 * ─── THE REP IS NOT CHECKED HERE ANY MORE ───────────────────────────────────
 *
 * It used to be, because the lookup and the document were one request. Under
 * resolve-first (Gerard, 16 Oct 2026) the lookup happens first and on its own,
 * so this checks only what identifies the PROPERTY. Asking for a presenting
 * rep before we can even say which parcel this is was the old flow's whole
 * problem in miniature: six fields filled in, then "that address matches four
 * properties", and a credit already gone.
 *
 * The rep and the prepared-for name are checked by `gateProblem` instead,
 * after the property is known and where getting them wrong costs nothing.
 */
export function lookupProblem(d: ConciergeDraft): string | null {
  if (d.mode === 'apn') {
    // LOOSELY VALIDATED ON PURPOSE. APN formats differ by county — Orange
    // writes 930-371-05, Los Angeles 6268-039-032, others run digits
    // together. A strict pattern would reject real parcels, and the vendor is
    // the only authority on whether one exists. So this checks it is
    // plausibly a parcel and nothing more: digits, with dashes or dots
    // allowed between them.
    const apn = d.apn.trim();
    if (apn === '') return 'Enter the parcel number (APN).';
    if (!/^[0-9]+([-.][0-9]+)*$/.test(apn)) {
      return 'A parcel number is digits, optionally separated by dashes or dots.';
    }
    if (apn.replace(/\D/g, '').length < 5) return 'That parcel number looks too short.';
    if (!/^\d{5}$/.test(d.fips.trim())) return 'Choose the county.';
    return null;
  }
  if (d.street.trim() === '') return 'Enter the property street address.';
  if (d.city.trim() === '') return 'Enter the city.';
  if (!/^\d{5}(-\d{4})?$/.test(d.zip.trim())) return 'Enter a 5-digit ZIP code.';
  if (d.state.trim().length !== 2) return 'Enter a 2-letter state.';
  return null;
}

/**
 * What is still missing before the DOCUMENT, none of which costs anything.
 *
 * Both of these end up printed on the cover, which is why they are required at
 * all — and why they are required here rather than before the lookup.
 */
export function gateProblem(g: { preparedForName: string; repContactId: number | null }): string | null {
  if (g.preparedForName.trim() === '') return 'Enter who this profile is prepared for.';
  if (!g.repContactId) return 'Choose the representative this profile goes out under.';
  return null;
}

export function fullAddress(d: ConciergeDraft): string {
  if (d.mode === 'apn') {
    const county = CALIFORNIA_COUNTIES.find((c) => c.fips === d.fips.trim());
    return `APN ${d.apn.trim()}${county ? ` · ${county.name} County` : ''}`;
  }
  return `${d.street.trim()}, ${d.city.trim()}, ${d.state.trim().toUpperCase()} ${d.zip.trim()}`;
}

/**
 * Apply a picked address to the draft.
 *
 * A PICK IS AUTHORITATIVE FOR THE WHOLE ADDRESS, including the parts Google did
 * not supply. The tempting alternative — keep the old value where the pick is
 * empty — leaves a ZIP from a *previously* picked property sitting under a new
 * street, which is the one error this modal cannot afford: a wrong property
 * spends a lookup and cannot be undone. Blanking instead means draftProblem()
 * immediately says "Enter a 5-digit ZIP code", which is visible and fixable.
 *
 * State is normalised the same way the manual field normalises it, so a pick
 * and a keystroke cannot produce different drafts.
 */
export function applyPickedAddress(d: ConciergeDraft, a: ParsedAddress): ConciergeDraft {
  return {
    ...d,
    // No `|| d.zip` fallbacks. Mutation-checked: adding them turns the
    // stale-value guard red, because a ZIP from a previously picked property
    // would survive under a new street.
    street: a.street,
    city: a.city,
    state: a.state.toUpperCase().slice(0, 2),
    zip: a.zip,
  };
}

export const DEFAULT_CRITERIA_SUMMARY = criteriaSummary(DEFAULT_CRITERIA);

/**
 * The body of the one request that spends.
 *
 * A function rather than an inline object because of what `allowDuplicate` is:
 * the single flag that lets a second credit be spent on a property we already
 * hold. It must be absent unless the operator was shown what we have and chose
 * to buy another — so it is built here, from a boolean, and asserted in a test.
 *
 * It was briefly wired as `confirm(allowDuplicate = freshRequested)` passed
 * straight to the gate's onClick, which hands its handler a MouseEvent: truthy,
 * every time. That would have sent allowDuplicate: true on every generation and
 * quietly disabled the guard this exists to enforce.
 */
export function resolveBody(input: {
  draft: ConciergeDraft;
  allowDuplicate: boolean;
  /**
   * The parcel picked out of a multi-match, on a retry.
   *
   * Sent only as a PAIR, and only when both halves are present — an `apn`
   * without a `fips` is the request shape the orders flow proved SiteX rejects,
   * and the feed client will not put it on the wire either. A candidate SiteX
   * returned without a FIPS is therefore not selectable, which the panel says
   * out loud rather than sending a request that cannot work.
   */
  parcel?: MatchCandidate | null;
}): Record<string, unknown> {
  const { draft: d, parcel } = input;
  const usable = parcel?.apn?.trim() && parcel.fips?.trim() ? parcel : null;

  // ─── APN MODE HAS NO POSTAL ADDRESS ──────────────────────────────────────
  //
  // The row still has to say what was asked for, and the Reports list prints
  // it. "APN 930-371-05" with the county is exactly that — honest about how
  // the property was identified, and legible before the vendor answers.
  //
  // NO FABRICATED ZIP. The field is optional on the route for this reason: a
  // made-up postcode on the row would be a claim about the property, and the
  // claim key is built from these strings.
  const county = CALIFORNIA_COUNTIES.find((c) => c.fips === d.fips.trim());
  const byApn = d.mode === 'apn';

  return {
    // No order here. The double-charge guard is keyed on the property.
    street: byApn ? `APN ${d.apn.trim()}` : d.street.trim(),
    city: byApn ? (county?.name ?? '') : d.city.trim(),
    state: byApn ? 'CA' : d.state.trim().toUpperCase(),
    ...(byApn ? {} : { zip: d.zip.trim() }),
    ...(byApn ? { apn: d.apn.trim(), fips: d.fips.trim() } : {}),
    // NO prepared-for name and NO rep. Neither is known at this point in the
    // flow, and neither has anything to do with which property to look up.
    ...(input.allowDuplicate ? { allowDuplicate: true } : {}),
    ...(usable ? { apn: usable.apn.trim(), fips: usable.fips!.trim() } : {}),
  };
}

/**
 * The body of the free half: who the document is for, and under whose name.
 *
 * Separate from `resolveBody` because the two requests go to different routes
 * for a reason that is about money rather than tidiness — one spends and one
 * cannot. Keeping them as one object was how a prepared-for name ended up
 * being required before anyone knew which parcel they were buying.
 */
export function finaliseBody(input: {
  draft: ConciergeDraft;
  preparedForName: string;
  preparedForCompany: string;
}): Record<string, unknown> {
  return {
    preparedForName: input.preparedForName.trim(),
    preparedForCompany: input.preparedForCompany.trim() || null,
    // Which contact, never their name, email or phone. The document's cover is
    // resolved server-side from the order, never accepted from the browser.
    presentingRepContactId: input.draft.repContactId,
  };
}

// ─── What the lookup bought ─────────────────────────────────────────────────

/**
 * The property the resolve step identified and paid for. Mirrors what
 * /api/concierge/resolve returns.
 */
export interface ResolvedProperty {
  profileId: number;
  creditsCharged: number;
  /** It was already paid for — by an earlier attempt, or by another operator. */
  reused: boolean;
  apn: string | null;
  county: string | null;
  siteAddress: string | null;
  siteCityState: string | null;
  primaryOwner: string | null;
  useDescription: string | null;
}

/**
 * What the operator reads back before the one call that spends.
 *
 * ─── IT IS A SEPARATE DIALOG FROM THE GATE, ON PURPOSE ──────────────────────
 *
 * The gate used to be the only confirmation, and it confirmed both things at
 * once: buy this property, and produce this document. That is why a
 * multi-match was so expensive — the operator had already filled in six
 * fields, so the question "which of these four parcels?" arrived after the
 * money was gone, and answering it charged again.
 *
 * So the two confirmations are split along the line that costs money. This one
 * shows the property and nothing else; there is nothing on it to get wrong
 * except the address, which is the only thing that matters here.
 *
 * The four properties the gate enforces are kept, for the same reasons:
 *   1. Cancel has focus, never the button that spends.
 *   2. Enter never confirms.
 *   3. Disabled in flight, so a double-click cannot double-spend.
 *   4. Escape cancels.
 */
export function LookupConfirm({ address, byApn, submitting, error, onCancel, onConfirm }: {
  address: string;
  byApn: boolean;
  /**
   * NO SPEND COUNT HERE, for the reason it was taken off the gate (Gerard,
   * 2026-09-23): operators hold no budget and cannot read a balance, so a
   * running total asked them to weigh something that was never theirs. What
   * makes this deliberate is the dialog existing at all, plus the duplicate
   * check keyed on the normalised property over all time.
   */
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="concierge-lookup-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !submitting) { e.stopPropagation(); onCancel(); }
        // Enter never confirms. The operator must click the button.
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); }
      }}
    >
      <div className="bg-white rounded-[10px] w-full max-w-[460px] shadow-xl border border-[#E5E5E5]">
        <div className="px-5 py-4 border-b border-[#F0F1F3]">
          <h2 id="concierge-lookup-title" className="text-[15px] font-semibold text-[#171717]">
            Look up this property
          </h2>
          <p className="text-[11.5px] text-[#6B7280] mt-[3px]">
            One property lookup. The report itself — who it is for, the rep, the comparables
            and the extras — comes next and is free.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[#9AA0AA]">
              {byApn ? 'Parcel' : 'Address'}
            </p>
            <p className="text-[12px] text-[#171717]">{address}</p>
          </div>

          {/* SAID HERE BECAUSE IT IS TRUE HERE, and it is the sentence that
              makes the new flow worth having. An address matching several
              parcels used to cost a lookup before the operator ever saw the
              list; now that answer is free and only the parcel they pick is
              paid for. */}
          <p className="text-[11px] text-[#6B7280]">
            If this address matches more than one property, you will be asked which one and
            nothing will be charged for the question.
          </p>

          {error && (
            <p className="text-[11.5px] text-[#8E2A1E] bg-[#FDECEA] border border-[#F2C4BD] rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#F0F1F3] flex items-center justify-end gap-2">
          <button
            // Focus lands on CANCEL. Never on the button that spends.
            autoFocus
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold border border-[#E5E5E5] bg-white text-[#3C4557] hover:bg-[#FAFAFB] disabled:opacity-50 outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-brand-orange text-white hover:bg-brand-orange-hover disabled:opacity-40 outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30"
          >
            {submitting ? 'Looking up…' : 'Look up property'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What the lookup actually found, under the address on the gate.
 *
 * ─── THE OWNER IS HERE FOR A REASON ─────────────────────────────────────────
 *
 * It is how an operator recognises a condominium unit. 25651 Paseo La Cresta
 * matched one candidate reading the same street line as the others; the thing
 * that identified it was `"Owner": "LIPSITZ"`. A parcel number alone asks the
 * operator to already know which unit they wanted.
 *
 * ─── AND IT SAYS WHEN NOTHING WAS CHARGED ───────────────────────────────────
 *
 * A reused resolution is good news and is said out loud. Hiding it would make
 * the lookup look like it had been skipped, and an operator who thinks a step
 * was skipped goes looking for a way to redo it.
 */
export function ResolvedNote({ resolved }: { resolved: ResolvedProperty }) {
  const site = [resolved.siteAddress, resolved.siteCityState].filter(Boolean).join(', ');
  const bits = [
    resolved.apn ? `APN ${resolved.apn}` : null,
    resolved.primaryOwner,
    resolved.useDescription,
  ].filter(Boolean) as string[];
  return (
    <>
      {site ? <p>{site}</p> : null}
      {bits.length > 0 ? <p>{bits.join(' · ')}</p> : null}
      {resolved.reused ? (
        <p className="text-[#3F7D58]">
          Already looked up — nothing was charged for this one.
        </p>
      ) : null}
    </>
  );
}

// ─── A multi-match is a question, not an error ───────────────────────────────

/** One parcel SiteX offered. Mirrors the candidate shape the feed returns. */
export interface MatchCandidate {
  address: string;
  city: string;
  state: string;
  zip: string;
  apn: string;
  unitNumber: string | null;
  unitType: string | null;
  fips: string | null;
  useCodeDescription: string | null;
  owner: string | null;
}

/**
 * The unit, written the way the vendor's own fields read.
 *
 * `UnitType` is not always a word. The real 300 for 4572 W 5th St sends
 * `"UnitType": "#"` with `"UnitNumber": "31"`, and joining those with a space
 * gives "# 31". So a punctuation type is prefixed tight and a word type gets
 * its space: "#31", but "APT 4".
 */
export function candidateUnit(c: MatchCandidate): string | null {
  const n = c.unitNumber?.trim();
  if (!n) return null;
  const t = c.unitType?.trim();
  if (!t) return n;
  return /^[A-Za-z]/.test(t) ? `${t} ${n}` : `${t}${n}`;
}

/**
 * Pick one of the parcels at this address.
 *
 * NOTHING HAS BEEN CHARGED when this appears. A 300 from SiteX is not billed,
 * so the panel is a choice taken before any spend — the same shape as
 * AlreadyHavePanel, deliberately, and nothing like the red box that used to
 * read "SiteX returned HTTP 300".
 *
 * THE UNIT IS THE POINT. Candidates at one address differ by unit and often by
 * nothing else; a list of six identical street lines is unusable, which the
 * orders flow found out when an operator searched 16281 Castello Ln four times
 * in six minutes. So the unit leads, and the APN is shown as the tiebreaker it
 * is when there is no unit at all.
 */
export function MatchCandidatesPanel({ message, candidates, busy, onPick, onCancel }: {
  message: string;
  candidates: MatchCandidate[];
  busy: boolean;
  onPick: (c: MatchCandidate) => void;
  onCancel: () => void;
}) {
  // SiteX returns a 300 with ONE candidate for a condo it has already
  // resolved: it wants the parcel confirmed, not disambiguated.
  const only = candidates.length === 1;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#333]">{message}</p>
      <ul className="space-y-2">
        {candidates.map((c, i) => {
          const unit = candidateUnit(c);
          // No FIPS means no searchable parcel. Saying so beats a button that
          // sends a request the feed client is documented to refuse.
          const selectable = Boolean(c.apn?.trim() && c.fips?.trim());
          return (
            <li key={`${c.apn}-${i}`}>
              <button
                type="button"
                disabled={busy || !selectable}
                onClick={() => onPick(c)}
                className="w-full text-left rounded-lg border border-[#E5E5E5] px-4 py-3 transition-colors hover:border-brand-orange disabled:opacity-50 disabled:hover:border-[#E5E5E5]"
              >
                <div className="text-[13px] font-semibold text-[#111]">
                  {unit ? `${unit} — ${c.address}` : c.address}
                </div>
                {/* The owner leads the second line, because it is the thing an
                    operator recognises. Absent when SiteX sent none. */}
                {c.owner ? (
                  <div className="text-[12px] text-[#333]">{c.owner}</div>
                ) : null}
                <div className="text-[11px] text-[#666]">
                  {[c.city, c.state, c.zip].filter(Boolean).join(', ')}
                  {c.apn ? ` · APN ${c.apn}` : ''}
                  {c.useCodeDescription ? ` · ${c.useCodeDescription}` : ''}
                </div>
                {!selectable ? (
                  <div className="text-[11px] text-[#A33]">
                    SiteX sent no county code for this one — it cannot be looked up by parcel.
                  </div>
                ) : null}
                {/* ─── ONE CANDIDATE IS A CONFIRMATION ──────────────────────
                    25651 Paseo La Cresta returned a 300 with exactly one
                    candidate. A single unlabelled row under "pick one" does
                    not look like a control at all — a rep reported the picker
                    as not appearing, having been shown precisely this. So the
                    one-candidate case gets a verb. */}
                {only ? (
                  <div className="mt-2 inline-block rounded-md bg-brand-orange px-3 py-1.5 text-[12px] font-semibold text-white">
                    {busy ? 'Working…' : 'Confirm this property'}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-[#666]">
        {only
          ? 'Confirming spends a single lookup, the same as generating normally. The attempt that found it was not charged.'
          : 'Picking one spends a single lookup, the same as generating normally. The attempt that produced this list was not charged.'}
      </p>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="text-[12px] text-[#666] underline disabled:opacity-50"
      >
        {only ? 'Not this property — back to the address' : 'Back to the address'}
      </button>
    </div>
  );
}

// ─── The type cards ─────────────────────────────────────────────────────────

export function TypeCard({ option, selected, onSelect }: {
  option: TypeOption; selected: boolean; onSelect: () => void;
}) {
  const base = 'w-full text-left rounded-lg border px-4 py-3 transition-colors';
  return (
    <button
      type="button"
      disabled={!option.available}
      onClick={onSelect}
      aria-pressed={selected}
      className={`${base} ${option.available
        ? selected
          ? 'border-[#1B2A4A] bg-[#F5F7FB]'
          : 'border-gray-200 bg-white hover:border-[#1B2A4A]/40'
        : 'border-gray-200 bg-[#FAFAFB] cursor-not-allowed'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`text-sm font-medium ${option.available ? 'text-[#1A1A2E]' : 'text-[#9AA0AA]'}`}>
          {option.label}
        </span>
        {option.costNote && option.available ? (
          <span className="shrink-0 rounded-full bg-[#FDF0E6] px-2 py-[2px] text-[10.5px] font-semibold text-[#B4620B]">
            {option.costNote}
          </span>
        ) : null}
        {option.unavailableNote ? (
          <span className="shrink-0 text-[10.5px] font-medium text-[#9AA0AA]">{option.unavailableNote}</span>
        ) : null}
      </div>
      <p className={`mt-1 text-xs ${option.available ? 'text-[#6B7280]' : 'text-[#B0B6BF]'}`}>{option.blurb}</p>
    </button>
  );
}

// ─── The presenting-rep picker lives in rep-combobox.tsx ────────────────────
//
// It used to be a search box here: two characters before it showed anything,
// eight results, a debounce and a request counter. Gerard asked for "all of the
// list so our user can easily select" and there are 54 reps, so the search and
// everything supporting it is gone — see RepCombobox for what replaced it and
// why. /api/contacts/search still serves its other callers unchanged.

// ─── Step two: the property ─────────────────────────────────────────────────

export function ConciergeStep({ draft, problem, onField, onAddress, repPicker, criteriaControl }: {
  draft: ConciergeDraft;
  problem: string | null;
  onField: (k: keyof ConciergeDraft, v: string) => void;
  /** One pick fills street, city, state and zip together. */
  onAddress: (a: ParsedAddress) => void;
  /**
   * OMITTED SINCE RESOLVE-FIRST (16 Oct 2026), and the omission is the change.
   *
   * The rep is printed on the document, so it belongs with the other things
   * the document needs — collected at the gate, after the property is known
   * and where getting it wrong costs nothing. Asking for it here meant an
   * operator chose a rep, then found out the address matched four parcels.
   *
   * Kept as an optional prop rather than deleted because the step is still
   * rendered by a flow that has a rep to show; a required prop would have
   * forced a placeholder, and a placeholder here is a field that looks like it
   * is being asked for.
   */
  repPicker?: React.ReactNode;
  /** The comparable criteria, set before generating. */
  criteriaControl: React.ReactNode;
}) {
  const input = 'w-full h-8 px-[9px] border border-[#E5E5E5] rounded-md text-[12px] outline-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange';
  const byApn = draft.mode === 'apn';
  const tab = (active: boolean) =>
    `px-3 h-7 text-[12px] rounded-md border transition-colors ${
      active
        ? 'border-brand-orange bg-brand-orange/10 text-[#111] font-semibold'
        : 'border-[#E5E5E5] text-[#666] hover:border-[#CCC]'
    }`;

  return (
    <div className="space-y-3">
      {/* ─── Address or parcel ────────────────────────────────────────────
          The order-creation flow has always had a parcel search and this one
          did not, so an operator holding an APN had nowhere to put it.

          It is also the escape hatch for an address SiteX will not resolve:
          a PARCEL SEARCH CANNOT MULTI-MATCH. 25651 Paseo La Cresta came back
          as a 300 because the street address names a whole condominium; the
          parcel names one unit and nothing else. */}
      <div className="flex items-center gap-2" role="tablist" aria-label="How to identify the property">
        <button
          type="button"
          role="tab"
          aria-selected={!byApn}
          className={tab(!byApn)}
          onClick={() => onField('mode', 'address')}
        >
          Address
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={byApn}
          className={tab(byApn)}
          onClick={() => onField('mode', 'apn')}
        >
          APN
        </button>
      </div>

      {byApn ? (
        <>
          <Field label="Parcel number (APN)">
            <input
              aria-label="Parcel number (APN)"
              value={draft.apn}
              onChange={(e) => onField('apn', e.target.value)}
              placeholder="930-371-05"
              className={input}
            />
          </Field>
          <Field label="County">
            {/* The county supplies the FIPS SiteX needs. Derived from the same
                table the order flow resolves against, so a county cannot
                exist in this list and not in the resolver. */}
            <select
              aria-label="County"
              value={draft.fips}
              onChange={(e) => onField('fips', e.target.value)}
              className={input}
            >
              <option value="">Choose a county…</option>
              {CALIFORNIA_COUNTIES.map((c) => (
                <option key={c.fips} value={c.fips}>{c.name}</option>
              ))}
            </select>
          </Field>
          <p className="text-[11px] text-[#666]">
            A parcel search names one property exactly, so it cannot come back asking
            which one you meant. Use it when an address will not resolve.
          </p>
        </>
      ) : (
      <>
      <Field label="Street address">
        {/* Autocomplete is an INPUT METHOD, not a replacement for the checks.
            draftProblem() is untouched: a picked address that came back without
            a ZIP still fails validation and still says so.

            Manual entry keeps working in three ways that matter — typing never
            requires a selection, the city/state/ZIP fields below stay editable
            after a pick, and with no NEXT_PUBLIC_GOOGLE_MAPS_API_KEY the
            component renders a plain text input. A rural or new-construction
            parcel Google has never heard of must not become unenterable.

            The placeholder is an instruction, not an address. A real one
            (1358 5th St, La Verne) read as prefilled rather than as an example,
            and an operator who does not notice it is empty is one keystroke
            from generating the wrong property — which spends a lookup and
            cannot be undone. */}
        <AddressAutocomplete
          value={draft.street}
          onChange={(v) => onField('street', v)}
          onSelect={onAddress}
          placeholder="Start typing an address, or type it in full"
          className={input}
        />
      </Field>
      {/* aria-label on each, because Field's <label> carries no htmlFor and the
          input is its sibling — so these three had no accessible name at all.
          Not fixed by wrapping them in the label: Field also wraps the rep
          combobox, and a click on an option inside a <label> would bounce focus
          back to the input and cancel the pick. */}
      <div className="grid grid-cols-[1fr_70px_110px] gap-2">
        <Field label="City">
          <input aria-label="City" value={draft.city} onChange={(e) => onField('city', e.target.value)} className={input} />
        </Field>
        <Field label="State">
          <input
            aria-label="State"
            value={draft.state}
            onChange={(e) => onField('state', e.target.value.toUpperCase().slice(0, 2))}
            className={input}
          />
        </Field>
        <Field label="ZIP">
          <input aria-label="ZIP" value={draft.zip} onChange={(e) => onField('zip', e.target.value)} className={input} />
        </Field>
      </div>
      </>
      )}

      {repPicker ? (
        <Field label="Presenting representative">
          {repPicker}
          <p className="mt-1 text-[10.5px] text-[#9AA0AA]">
            The profile goes out under their name, with their phone and email on it.
          </p>
        </Field>
      ) : null}

      {/* ─── The criteria live in BOTH places, and here is why ──────────────
          THE CRITERIA NEVER REACH SiteX. fetchConciergeProfile sends exactly
          three parameters — addr, lastLine and feedId. The vendor returns
          whatever comparables it holds for the parcel and selectComps filters
          that stored set locally. A wider radius does not search wider; a
          narrower one does not cost less.

          The corollary is that nobody can know what a criteria set yields
          until the payload has arrived. So these are a STARTING GUESS, and the
          free panel after generation is where tuning happens with the yield in
          front of you. Both need to exist. The operator looked for this
          control during creation and found nothing, which is the whole of the
          "criteria control does nothing" report. */}
      <Field label="Comparable criteria">
        {criteriaControl}
        <p className="mt-1 text-[10.5px] text-[#9AA0AA]">
          A starting point. These filter the comparables the search returns — they
          do not change what is searched for, or the cost. Adjusting them after the
          profile exists is free, and shows how many sales each setting keeps.
        </p>
      </Field>

      {problem ? <p className="text-[11.5px] text-[#B4620B]">{problem}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[#9AA0AA] mb-1">{label}</label>
      {children}
    </div>
  );
}

export interface ExistingProfileNotice {
  id: number;
  createdAt: string;
  ageDays: number;
  preparedForName: string | null;
}

/**
 * What the operator sees when we already hold this property.
 *
 * NOT A REFUSAL. A six-month-old profile may legitimately need refreshing; a
 * same-week one almost never does. Both buttons are real, and the one that
 * spends says so.
 */
export function AlreadyHavePanel({ message, existing, onOpen, onFresh }: {
  message: string;
  existing: ExistingProfileNotice;
  onOpen: () => void;
  onFresh: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#E7D9C0] bg-[#FDF8EF] px-4 py-3">
      <p className="text-[12px] text-[#6B4E16]">{message}</p>
      {existing.preparedForName ? (
        <p className="mt-[3px] text-[10.5px] text-[#9A8455]">
          Prepared for {existing.preparedForName}.
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-[#1B2A4A] text-white hover:bg-[#243658]"
        >
          Open the existing profile
        </button>
        <button
          type="button"
          onClick={onFresh}
          className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold border border-[#E5E5E5] bg-white text-[#3C4557] hover:bg-[#FAFAFB]"
        >
          Generate a fresh one
        </button>
      </div>
    </div>
  );
}

// ─── The modal ──────────────────────────────────────────────────────────────

const EMPTY: ConciergeDraft = {
  mode: 'address', street: '', city: '', state: 'CA', zip: '',
  apn: '', fips: '', repContactId: null, repName: '',
};

/**
 * MOUNTED ONLY WHILE OPEN. The page renders `{open && <NewReportModal …/>}`, so
 * every open starts from an empty form — the same rule the cost gate follows.
 * A half-filled address left over from a cancelled attempt is how the wrong
 * property gets bought.
 */
export function NewReportModal({ onClose, onCreated }: {
  onClose: () => void;
  /** A report row now exists. The list reloads; nothing is sent. */
  onCreated: (profileId: number) => void;
}) {
  const [access, setAccess] = useState<ConciergeAccess | null>(null);
  const [selected, setSelected] = useState<ReportType | null>(null);
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [draft, setDraft] = useState<ConciergeDraft>(EMPTY);
  // The starting guess. These filter what the search returns; they are not
  // sent to SiteX and do not change the cost — see ConciergeStep.
  const [criteria, setCriteria] = useState<CompCriteria>(DEFAULT_CRITERIA);
  const [preparedForName, setPreparedForName] = useState('');
  const [preparedForCompany, setPreparedForCompany] = useState('');
  /**
   * The TitlePoint tax search. DEFAULT FALSE.
   *
   * It has to live here, because the follow-up POST happens after the gate is
   * gone. But the gate is mounted only while open SO THAT A SPEND CANNOT SURVIVE
   * A CANCEL, and a flag held out here would quietly break that: tick it, cancel,
   * reopen, and the second generation carries a charge nobody asked for on this
   * pass. So openGate() puts it back to false every time — the reset is what
   * makes state up here equivalent to state inside a remounted dialog.
   */
  const [taxDetail, setTaxDetail] = useState(false);
  /**
   * The MyNHD hazard preview. DEFAULTS TRUE — Gerard, 12 Oct 2026 — because
   * it costs PCT nothing. The tax box above defaults false for the opposite
   * reason, and the two sitting side by side with different defaults is the
   * point rather than an inconsistency: the default follows the price.
   *
   * openGate() does NOT reset this the way it resets taxDetail. That reset
   * exists so a spend cannot survive a cancel; there is no spend here, and
   * resetting a free opt-in that defaults on would be a no-op anyway.
   */
  const [hazard, setHazard] = useState(true);
  /** Whether this deploy can reach MyNHD. Null until /access answers. */
  const [hazardAvailable, setHazardAvailable] = useState(false);
  /**
   * The profile was made and the tax search was NOT started. Held on screen,
   * like repWarning, rather than flashed — it is the only notice an operator
   * gets that something they asked for did not happen.
   */
  const [taxProblem, setTaxProblem] = useState<string | null>(null);
  /** Holding the gate open while the county is searched. See confirm(). */
  const [taxWaiting, setTaxWaiting] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [spend, setSpend] = useState<{ thisMonth: number; allTime: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The report was made and its rep will never see it. Held, not flashed. */
  const [repWarning, setRepWarning] = useState<string | null>(null);
  const [showProblem, setShowProblem] = useState(false);
  const [existing, setExisting] = useState<{ existing: ExistingProfileNotice; message: string } | null>(null);
  /**
   * SiteX asked which property. Held, not flashed, and not an error — nothing
   * was charged for the attempt that produced it.
   */
  const [ambiguous, setAmbiguous] = useState<{ message: string; candidates: MatchCandidate[] } | null>(null);
  /**
   * The confirmation in front of THE LOOKUP, which is the step that spends.
   *
   * It is a separate dialog from the gate, because they now confirm different
   * things: this one confirms buying a property, the gate confirms producing a
   * document for a named client. Folding them back together is how the old
   * flow charged for a multi-match the operator had not seen yet.
   */
  const [lookupConfirm, setLookupConfirm] = useState(false);
  /**
   * The property the lookup found, and the id of the row holding its payload.
   *
   * Everything from here on is free. Cancelling the gate leaves this resolution
   * on the Reports list as "Looked up — not yet generated", and starting again
   * on the same address finds it and finishes it without a second lookup.
   */
  const [resolved, setResolved] = useState<ResolvedProperty | null>(null);
  /**
   * The address the resolution in hand was for.
   *
   * Cancelling the gate and pressing Continue again must not ask SiteX
   * anything: we are holding the answer. The server would hand the same
   * resolution back for nothing — the reuse path exists precisely for this —
   * but a request that cannot change the outcome should not be made, and a
   * lookup confirmation in front of it would tell the operator a lookup is
   * about to happen when it is not.
   *
   * Keyed on the address rather than a boolean so that EDITING the address
   * invalidates it. A stale yes here would generate a document for the
   * previous property under the new address, which is the one mistake this
   * modal cannot take back.
   */
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [freshRequested, setFreshRequested] = useState(false);
  const [farming, setFarming] = useState<boolean | null>(null);
  const [farmingDraft, setFarmingDraft] = useState<FarmingDraft>(() => emptyFarmingDraft());

  // Asked on every open, not cached: the flag can be turned on while the page
  // is sitting there, and a stale "not enabled" would hide a feature that works.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/concierge/access')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ConciergeAccess | null) => {
        if (!cancelled) setAccess(d ?? { canGenerate: false, featureOn: false });
        // Same field the row action reads, so the two controls cannot
        // disagree about whether MyNHD is reachable from this deploy.
        if (!cancelled) setHazardAvailable(d?.hazardAvailable === true);
      })
      .catch(() => { if (!cancelled) setAccess({ canGenerate: false, featureOn: false }); });
    fetch('/api/reports/access')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { farming?: boolean } | null) => { if (!cancelled) setFarming(!!d?.farming); })
      .catch(() => { if (!cancelled) setFarming(false); });
    return () => { cancelled = true; };
  }, []);

  // The address step's own problem. The rep and the prepared-for name are
  // checked by gateProblem, after the property is known — see lookupProblem.
  const problem = lookupProblem(draft);
  const farmingType = isFarming(selected) ? selected : null;
  const fProblem = farmingType ? farmingProblem(farmingType, farmingDraft) : null;

  /**
   * Create a farming report. No gate: it spends nothing. A refusal comes back
   * as the generator wrote it and stays on the form, so the operator can fix
   * the file and try again without re-entering anything.
   */
  async function submitFarming() {
    if (!farmingType) return;
    if (fProblem) { setShowProblem(true); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/reports/farming', { method: 'POST', body: farmingFormData(farmingType, farmingDraft) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `The report could not be created (${res.status}).`);
        // A failed row exists and is on the list with "Try again".
        if (body?.reportId) onCreated(body.reportId as number);
        return;
      }
      onCreated(body.reportId as number);
      // A report that cannot reach its rep is still a report. The modal stays
      // open so the sentence is READ rather than flashing past on a list the
      // operator may not look at — closing here is how the silent failure
      // stays silent.
      if (body?.repWarning) { setRepWarning(body.repWarning as string); return; }
      onClose();
    } catch {
      setError('Network error — the report may or may not have been created. Check the list before trying again.');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Continue. Asks whether we already hold this property BEFORE the gate opens,
   * so the question is answered while deciding rather than after clicking a
   * button that spends. The server asks again; this is for the operator.
   */
  async function onContinue() {
    if (farmingType) { await submitFarming(); return; }
    if (problem) { setShowProblem(true); return; }
    setError(null);
    setChecking(true);
    try {
      const p = new URLSearchParams({
        street: draft.street.trim(), city: draft.city.trim(),
        state: draft.state.trim().toUpperCase(), zip: draft.zip.trim(),
      });
      const res = await fetch(`/api/concierge/for-property?${p}`);
      const body = await res.json().catch(() => null);
      if (body?.existing) { setExisting({ existing: body.existing, message: body.message }); return; }
    } catch {
      // A lookup that fails must not block the flow: the server checks again
      // and is what actually stops a second charge.
    } finally {
      setChecking(false);
    }
    // ALREADY HOLDING THE ANSWER for this exact address — the operator backed
    // out of the gate and came back. Straight to the gate: nothing to ask, so
    // no confirmation in front of a lookup that is not going to happen.
    if (resolved && resolvedFor === fullAddress(draft)) { openGate(); return; }

    // THE LOOKUP CONFIRMATION, not the gate. This is where the spend is now,
    // so this is where the operator reads the property back before it happens.
    setLookupConfirm(true);
  }

  function openGate() {
    setError(null);
    // EVERY OPEN STARTS UNARMED. The gate itself is remounted on each open so
    // that nothing about a spend survives a cancel; this flag lives outside it
    // because the POST it controls happens after the gate is gone, so it has to
    // be reset by hand to keep the same property.
    setTaxDetail(false);
    setGateOpen(true);
    // Read when the gate opens, so the number is current rather than whatever
    // it was when the page loaded.
    fetch('/api/concierge/spend')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { thisMonth: number; allTime: number } | null) => { if (d) setSpend(d); })
      .catch(() => {});
  }

  /**
   * THE ONLY CALL IN THIS FILE THAT SPENDS.
   *
   * IT NOW TAKES AN ARGUMENT, AND EVERY CALLER PASSES ONE EXPLICITLY. This
   * used to take none on purpose, because the gate calls it from an onClick
   * and an onClick hands a MouseEvent to the first parameter of whatever it
   * is given — truthy, every time. That is not a theoretical hazard: it is how
   * `allowDuplicate` was briefly wired, and it would have disabled the
   * double-charge guard on every generation (see generationBody).
   *
   * TypeScript does not catch it. `onConfirm: () => void` accepts a function
   * that declares parameters, so the mistake typechecks. So the gate is wired
   * through an arrow that passes `null`, and the parameter is required rather
   * than optional — an omitted argument is now a compile error, which is the
   * only part of this that a future edit cannot quietly undo.
   */
  /**
   * THE ONLY CALL IN THIS FILE THAT SPENDS. Which property is this?
   *
   * IT TAKES ITS ARGUMENT EXPLICITLY, AND EVERY CALLER PASSES ONE. The
   * previous version of this function took none on purpose, because the gate
   * called it from an onClick and an onClick hands a MouseEvent to the first
   * parameter of whatever it is given — truthy, every time. That is not a
   * theoretical hazard: it is how `allowDuplicate` was briefly wired, and it
   * would have disabled the double-charge guard on every generation.
   *
   * TypeScript does not catch it. `onConfirm: () => void` accepts a function
   * that declares parameters, so the mistake typechecks. So the parameter is
   * required rather than optional and every call site passes it, which is the
   * only part of this a future edit cannot quietly undo.
   *
   * ─── WHAT CHANGED, AND WHY IT IS NOT THE GATE ANY MORE ──────────────────
   *
   * This used to run from inside the confirmation gate, after the operator had
   * typed a prepared-for name, chosen a rep and picked their add-ons. A
   * multi-match then threw all of that back at them having already charged.
   * Now it runs from the address step, and the gate below it cannot spend.
   */
  async function resolve(parcel: MatchCandidate | null) {
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/concierge/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resolveBody({
          draft, allowDuplicate: freshRequested, parcel: parcel ?? null,
        })),
      });
      const body = await res.json().catch(() => null);
      if (body?.spend) setSpend(body.spend);

      // ─── SiteX asked which property ──────────────────────────────────────
      //
      // Before the generic !res.ok branch, because this is not a failure to
      // report: it is a question with an answer attached, and NOTHING WAS
      // CHARGED. Answering it now costs one lookup in total — under the old
      // flow the address search charged, and so did the pick.
      if (body?.reason === 'ambiguous_match' && Array.isArray(body.candidates) && body.candidates.length > 0) {
        setLookupConfirm(false);
        setAmbiguous({ message: body.error as string, candidates: body.candidates as MatchCandidate[] });
        return;
      }

      // We already hold a finished profile for this property. Nothing spent.
      if (res.status === 409 && body?.reason === 'already_have' && body?.existing) {
        setLookupConfirm(false);
        setExisting({ message: body.error as string, existing: body.existing as ExistingProfileNotice });
        return;
      }

      if (!res.ok) {
        // A refusal may still have left a row and may still have cost a
        // lookup. Point the operator at the list rather than back to a form
        // that invites a second click at the same property.
        setError(body?.error ?? `The property could not be looked up (${res.status}).`);
        setLookupConfirm(false);
        if (body?.profileId) onCreated(body.profileId as number);
        return;
      }

      // PAID FOR AND STORED. Everything from here is free, which is what makes
      // the gate below safe to get wrong and cancel out of.
      setResolved(body as ResolvedProperty);
      setResolvedFor(fullAddress(draft));
      setLookupConfirm(false);
      openGate();
    } catch {
      setError('Network error — the property may or may not have been looked up. Check the list before trying again.');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Turn the resolution into a document. FREE — it cannot reach the vendor.
   *
   * Takes the profile id explicitly for the same reason `resolve` takes its
   * parcel explicitly: it is called from an onClick, and an onClick passes a
   * MouseEvent to the first parameter of whatever it is handed.
   */
  async function finalise(profileId: number) {
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/concierge/profiles/${profileId}/finalise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finaliseBody({ draft, preparedForName, preparedForCompany })),
      });
      const body = await res.json().catch(() => null);

      // Somebody else finished this property while the gate was open — the
      // second operator in the window. Not a failure: open it.
      if (res.status === 409 && body?.reason === 'already_generated') {
        setGateOpen(false);
        onCreated(profileId);
        onClose();
        return;
      }

      if (!res.ok) {
        // The property is bought and stored, so this is retryable for nothing.
        setError(body?.error ?? `The document could not be produced (${res.status}).`);
        onCreated(profileId);
        return;
      }

      // ─── The tax search, AFTER the profile exists ────────────────────────
      //
      // Deliberately not part of the generate request. TitlePoint tax is
      // create/poll/fetch and takes minutes; holding the charging request open
      // for it is the charged-but-incomplete failure resume exists for. This
      // call only STARTS it and returns as soon as the spend is decided.
      //
      // ─── IT IS AWAITED, AND ITS ANSWER IS READ ───────────────────────────
      //
      // This was `void fetch(...).catch(() => {})` followed immediately by
      // onClose(). That is unfalsifiable: the request is not awaited, the modal
      // unmounts underneath it, and every possible error is discarded. The
      // comment defending it said the row's tax status is where the operator
      // learns what happened — but a request that never lands creates no row,
      // so the channel meant to report the problem does not exist either. Tick
      // the box, modal closes, nothing anywhere says a word.
      //
      // A FAILURE STILL DOES NOT FAIL THE PROFILE. It is generated, paid for
      // and complete without page 4. So this reports that the tax search could
      // not be STARTED, and leaves the profile alone.
      // ─── The hazard preview, BEFORE the tax wait ─────────────────────────
      //
      // Fired first because it is free and fast — one round trip, no polling —
      // and because the tax step below deliberately HOLDS the gate open for up
      // to fifteen seconds. Running this after that wait would delay a free
      // sheet behind a paid search for no reason.
      //
      // ITS FAILURE NEVER FAILS THE PROFILE, and never blocks delivery. The
      // profile is generated, paid for and complete without a hazard sheet, so
      // a refusal is reported the same way a tax failure is — held on screen
      // after the gate closes — and nothing is retried here. The row action
      // adds it later.
      if (hazard && hazardAvailable) {
        const got = await startHazardPreview(profileId);
        if (!got.ok) {
          onCreated(profileId);
          setGateOpen(false);
          setTaxProblem(got.message);
          return;
        }
      }

      if (taxDetail) {
        const started = await startTaxSearch(profileId);
        if (!started.ok) {
          onCreated(profileId);
          // THE GATE HAS TO GO FIRST. It is a fixed overlay, so leaving it up
          // would put this notice behind the very dialog the operator just
          // confirmed — a silent failure dressed as a visible one. Caught by
          // the test, which found "row in Reports" twice on screen.
          setGateOpen(false);
          setTaxProblem(started.message);
          return;
        }

        // ─── Wait for it, because it is quick ───────────────────────────────
        //
        // Measured over 405 completed searches: median 2.4s, p90 3.8s, max
        // 11.8s, and 100% inside 15 seconds. Handing over a report whose tax
        // page is about to change, three seconds before it changes, is how
        // Gerard ended up with a document that did not match its own status.
        //
        // Calling the route AGAIN is what finishes it: the first call buys the
        // search, the second polls and re-renders inside the request, so the
        // work happens where somebody is waiting rather than in a promise that
        // can be frozen. It cannot buy a second search.
        if (started.status === 'pending') {
          setTaxWaiting(true);
          const done = await finishTaxSearch(profileId);
          setTaxWaiting(false);
          if (!done.ok) {
            // NOT AN ERROR. The search is paid for and the sweeper will finish
            // it; the operator simply should not be held any longer.
            onCreated(profileId);
            setGateOpen(false);
            setTaxProblem(done.message);
            return;
          }
        }
      }

      onCreated(profileId);
      onClose();
    } catch {
      setError('Network error — the profile may or may not have been generated. Check the list before trying again.');
    } finally {
      setSubmitting(false);
    }
  }

  const options = typeOptions(access, farming);

  return (
    <>
      {/* WIDE on the details step, default when choosing a type.
          The type list is four cards and does not want the room; the details
          step carries an address, a rep dropdown and the comparable criteria,
          and at max-w-lg the criteria sliders had nowhere to go. */}
      <ModalShell
        open
        onClose={onClose}
        title="New Report"
        size={step === 'details' ? 'wide' : undefined}
        subtitle={step === 'type' ? 'Choose a type' : (options.find((o) => o.type === selected)?.label ?? '')}
      >
        <div className="px-5 py-4">
          {step === 'type' ? (
            <div className="space-y-2">
              {options.map((o) => (
                <TypeCard
                  key={o.type}
                  option={o}
                  selected={selected === o.type}
                  onSelect={() => setSelected(o.type)}
                />
              ))}
            </div>
          ) : farmingType ? (
            <FarmingStep
              type={farmingType}
              draft={farmingDraft}
              problem={showProblem ? fProblem : null}
              onField={(k, v) => setFarmingDraft((d) => ({ ...d, [k]: v }))}
              onFile={(f) => setFarmingDraft((d) => ({ ...d, file: f }))}
              repPicker={(
                <RepCombobox
                  chosenName={farmingDraft.repName}
                  onChoose={(r) => setFarmingDraft((d) => ({ ...d, repContactId: r.id, repName: r.name }))}
                  onClear={() => setFarmingDraft((d) => ({ ...d, repContactId: null, repName: '' }))}
                />
              )}
            />
          ) : ambiguous ? (
            <MatchCandidatesPanel
              message={ambiguous.message}
              candidates={ambiguous.candidates}
              busy={submitting}
              // THE PICK IS THE SPEND. The question was free; resolving the
              // chosen parcel is the one lookup. Under the old flow the
              // address search had already charged before this list appeared.
              onPick={(c) => { void resolve(c); }}
              onCancel={() => { setAmbiguous(null); setError(null); }}
            />
          ) : existing ? (
            <AlreadyHavePanel
              message={existing.message}
              existing={existing.existing}
              onOpen={() => {
                window.open(`/api/concierge/profiles/${existing.existing.id}/pdf`, '_blank');
                onClose();
              }}
              // A fresh one means a fresh LOOKUP now, so it goes to the lookup
              // confirmation rather than the gate — and `freshRequested` also
              // skips reuse of any resolution we already hold, because someone
              // who asked for fresh data should not be handed this morning's.
              onFresh={() => { setFreshRequested(true); setExisting(null); setLookupConfirm(true); }}
            />
          ) : (
            <ConciergeStep
              draft={draft}
              problem={showProblem ? problem : null}
              onField={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
              onAddress={(a) => setDraft((d) => applyPickedAddress(d, a))}
              criteriaControl={<CriteriaFields criteria={criteria} onChange={setCriteria} />}
              /* NO repPicker. It moved to the gate — see ConciergeStep. */
            />
          )}

          {error && !gateOpen ? (
            <p className="mt-3 text-[11.5px] text-[#8E2A1E] bg-[#FDECEA] border border-[#F2C4BD] rounded-md px-3 py-2">
              {error}
            </p>
          ) : null}

          {/*
            The report EXISTS. This is amber, not red, and says so — an
            operator who reads "will NOT appear in their own Reports list" and
            thinks the generation failed will make a second one.
          */}
          {repWarning ? (
            <div className="mt-3 text-[11.5px] text-[#7C4A03] bg-[#FEF6E7] border border-[#F3D9A4] rounded-md px-3 py-2">
              <p className="font-medium">The report was created.</p>
              <p className="mt-1">{repWarning}</p>
              <button
                type="button"
                onClick={() => { setRepWarning(null); onClose(); }}
                className="mt-2 text-[11px] font-medium text-[#1B2A4A] hover:underline"
              >
                Understood — close
              </button>
            </div>
          ) : null}

          {/* THE PROFILE IS FINE AND THE THING THEY TICKED DID NOT HAPPEN.
              Amber, not red, and it says both halves — an operator who reads
              only "could not be started" must not think the report failed. It
              also says where to do it instead, because the row action can. */}
          {taxProblem ? (
            <div className="mt-3 text-[11.5px] text-[#7C4A03] bg-[#FEF6E7] border border-[#F3D9A4] rounded-md px-3 py-2">
              <p className="font-medium">The profile was created. The tax search was not started.</p>
              <p className="mt-1">{taxProblem}</p>
              <button
                type="button"
                onClick={() => { setTaxProblem(null); onClose(); }}
                className="mt-2 text-[11px] font-medium text-[#1B2A4A] hover:underline"
              >
                Understood — close
              </button>
            </div>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={step === 'type' ? onClose : () => { setExisting(null); setStep('type'); }}
            className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold border border-[#E5E5E5] bg-white text-[#3C4557] hover:bg-[#FAFAFB]"
          >
            {step === 'type' ? 'Cancel' : 'Back'}
          </button>
          {/* Hidden while either panel is up. Both are choices with their own
              buttons, and a Continue beside them would start the flow again
              from the address — on the multi-match panel that means asking
              SiteX the same question whose answer is already on screen. */}
          {existing || ambiguous ? null : (
            <button
              type="button"
              disabled={(step === 'type' && selected === null) || checking || (farmingType !== null && submitting)}
              onClick={step === 'type' ? () => { setShowProblem(false); setError(null); setStep('details'); } : onContinue}
              className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-[#1B2A4A] text-white hover:bg-[#243658] disabled:opacity-40"
            >
              {checking ? 'Checking…'
                : step === 'details' && farmingType ? (submitting ? 'Creating…' : 'Create report')
                  : 'Continue'}
            </button>
          )}
        </div>
      </ModalShell>

      {/* MOUNTED ONLY WHILE OPEN, so nothing about a spend survives a cancel and
          pre-arms the next generation. taxDetail is the one flag that has to live
          outside — openGate() resets it for exactly this reason. */}
      {lookupConfirm ? (
        <LookupConfirm
          address={fullAddress(draft)}
          byApn={draft.mode === 'apn'}
          submitting={submitting}
          error={error}
          onCancel={() => { if (!submitting) { setLookupConfirm(false); setError(null); } }}
          onConfirm={() => {
            // An arrow, not `resolve` itself: onClick passes a MouseEvent into
            // the first parameter of whatever it is handed. See resolve().
            void resolve(null);
          }}
        />
      ) : null}

      {gateOpen && resolved ? (
        <ConciergeCostGate
          address={fullAddress(draft)}
          // NOTHING FURTHER IS CHARGED, and the dialog says so instead of
          // repeating a lookup warning that is no longer true here.
          spends={false}
          resolvedNote={<ResolvedNote resolved={resolved} />}
          preparedForName={preparedForName}
          preparedForCompany={preparedForCompany}
          presentingRepName={draft.repName}
          presentingRepProblem={null}
          repPicker={(
            /* `r.name`, never `r.label`. The label carries the disambiguation —
               "Kevin Cameron · #8821" — which exists to help the operator
               choose and must never reach the document's cover, where it would
               read as the rep's name. */
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[#9AA0AA] mb-1">
                Presenting representative
              </p>
              <RepCombobox
                chosenName={draft.repName}
                onChoose={(r) => setDraft((d) => ({ ...d, repContactId: r.id, repName: r.name }))}
                onClear={() => setDraft((d) => ({ ...d, repContactId: null, repName: '' }))}
              />
              <p className="mt-1 text-[10.5px] text-[#9AA0AA]">
                The profile goes out under their name, with their phone and email on it.
              </p>
            </div>
          )}
          criteriaSummary={DEFAULT_CRITERIA_SUMMARY}
          spend={spend}
          submitting={submitting}
          error={error}
          taxDetail={taxDetail}
          hazard={hazard}
          onHazard={setHazard}
          hazardAvailable={hazardAvailable}
          taxWaiting={taxWaiting}
          onTaxDetail={setTaxDetail}
          onPreparedForName={setPreparedForName}
          onPreparedForCompany={setPreparedForCompany}
          // CANCELLING HERE THROWS AWAY NOTHING THAT WAS PAID FOR. The
          // resolution stays on the Reports list as "Looked up — not yet
          // generated", and starting again on the same address finds it and
          // finishes it without a second lookup.
          onCancel={() => { if (!submitting) { setGateOpen(false); setError(null); } }}
          onConfirm={() => {
            // An arrow, not `finalise` itself: onClick passes a MouseEvent
            // into the first parameter of whatever it is handed. See
            // finalise(), and the `resolved` guard on this whole block, which
            // is what makes the id safe to assert here.
            void finalise(resolved.profileId);
          }}
        />
      ) : null}
    </>
  );
}

// ─── The tax search, from the browser's side ────────────────────────────────
//
// Two calls to one route. The first buys the search; the second finishes it.
// Both are the same endpoint because finishing is what asking again DOES — a
// search already paid for is polled and re-rendered, never re-bought.

interface TaxStep { ok: boolean; status?: string; message: string }

/**
 * Fetch the hazard preview. FREE, and it finishes inside the request.
 *
 * Unlike the tax search there is nothing to poll: MyNHD answers in one round
 * trip, the bridge rasterises and re-renders, and the route returns when the
 * sheet is on the document. So there is no waiting state and no spinner —
 * either the sheet is there when the modal closes or the message says why not.
 *
 * `keepalive` for the same reason as the tax call: a close must not cancel a
 * request the operator has already asked for. It spends nothing, but a
 * half-finished fetch would leave the row needing the sweeper.
 */
async function startHazardPreview(profileId: number): Promise<TaxStep> {
  try {
    const res = await fetch(`/api/concierge/profiles/${profileId}/nhd`, {
      method: 'POST',
      keepalive: true,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      return {
        ok: false,
        message: body?.message
          ?? `The hazard preview could not be added (${res.status}). You can add it from the report’s row in Reports.`,
      };
    }
    return { ok: true, status: String(body?.hazardStatus ?? 'ready'), message: '' };
  } catch {
    return {
      ok: false,
      message: 'The request did not reach the server, so no hazard preview was added. Nothing was charged. You can add it from the report’s row in Reports.',
    };
  }
}

/** Buy it. Fast — this returns as soon as TitlePoint has accepted the search. */
async function startTaxSearch(profileId: number): Promise<TaxStep> {
  try {
    const res = await fetch(`/api/concierge/profiles/${profileId}/tax`, {
      method: 'POST',
      // Survives an unmount, so a close cannot cancel a request that spends.
      keepalive: true,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      return {
        ok: false,
        message: body?.message
          ?? `The tax search could not be started (${res.status}). You can add tax detail from the report’s row in Reports.`,
      };
    }
    return { ok: true, status: String(body?.taxStatus ?? 'pending'), message: '' };
  } catch {
    return {
      ok: false,
      message: 'The request did not reach the server, so no tax search was started and nothing was charged for one. You can add tax detail from the report’s row in Reports.',
    };
  }
}

/**
 * Finish it, with a ceiling on how long an operator is held.
 *
 * FIFTEEN SECONDS, from the measurement: 405 completed searches, median 2.4s,
 * p90 3.8s, max 11.8s — every one of them inside fifteen. So the cap is past
 * the worst case we have ever recorded rather than a round number, and hitting
 * it means something genuinely unusual.
 *
 * GIVING UP IS NOT FAILING. The search is bought and stored either way, and
 * concierge.tax_finish sweeps whatever is outstanding. All this decides is
 * whether the operator waits.
 */
const TAX_WAIT_CEILING_MS = 15_000;

async function finishTaxSearch(profileId: number): Promise<TaxStep> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TAX_WAIT_CEILING_MS);
  try {
    const res = await fetch(`/api/concierge/profiles/${profileId}/tax`, {
      method: 'POST',
      signal: ac.signal,
    });
    const body = await res.json().catch(() => null);
    const status = String(body?.taxStatus ?? '');
    if (status === 'ready' || status === 'empty') return { ok: true, status, message: '' };
    if (status === 'denied') {
      return {
        ok: false, status,
        message: body?.message ?? 'This county is not entitled for tax searches, so nothing was charged. The profile is complete without page 4.',
      };
    }
    return {
      ok: false, status,
      message: body?.message
        ?? 'The tax search is taking longer than usual. It is paid for and will finish on its own — the document updates itself, and the report’s row shows where it is.',
    };
  } catch {
    // Includes the abort. Deliberately the same message: from the operator's
    // side "still going" and "I stopped waiting" are the same fact.
    return {
      ok: false,
      message: 'The tax search is taking longer than usual. It is paid for and will finish on its own — the document updates itself, and the report’s row shows where it is.',
    };
  } finally {
    clearTimeout(timer);
  }
}
