'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ModalShell } from '@/components/shared/action-modals/modal-shell';
import { ConciergeCostGate } from '@/components/hub/split/concierge-cost-gate';
import { criteriaSummary } from '@/lib/domain/concierge/list-line';
import { DEFAULT_CRITERIA } from '@/lib/domain/concierge/comp-filter';
import type { ReportType } from '@/lib/domain/reports/list-types';

// ─── New Report ─────────────────────────────────────────────────────────────
//
// ONE TYPE WORKS TODAY: Concierge Profile. The three farming types are shown
// because a picker that hid them would say the product is smaller than it is —
// but they are NOT selectable and they open nothing. A stub that accepts a
// click and produces no report is worse than a greyed card that says when.
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
}

const COMING = 'Not yet available';

/**
 * The cards, and which of them can be clicked. Access is the SERVER's answer,
 * so a flag that is off produces a card that says so rather than a button that
 * fails at the vendor.
 */
export function typeOptions(access: ConciergeAccess | null): TypeOption[] {
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
      costNote: '1 credit',
    },
    {
      type: 'sales_activity',
      label: 'Sales Activity',
      blurb: 'Sales in an area over a period, by city and price band.',
      available: false, unavailableNote: COMING, costNote: null,
    },
    {
      type: 'carrier_route',
      label: 'Carrier Route Analysis',
      blurb: 'Turnover and owner tenure by postal carrier route.',
      available: false, unavailableNote: COMING, costNote: null,
    },
    {
      type: 'county_sales',
      label: 'County Sales',
      blurb: 'A county month: volume, median price, share by type.',
      available: false, unavailableNote: COMING, costNote: null,
    },
  ];
}

export interface ConciergeDraft {
  street: string;
  city: string;
  state: string;
  zip: string;
  repContactId: number | null;
  repName: string;
}

/**
 * What is still missing, in the words the operator needs. Returned rather than
 * thrown so the button can be disabled AND the reason shown — a disabled button
 * with no explanation is a dead end.
 */
export function draftProblem(d: ConciergeDraft): string | null {
  if (d.street.trim() === '') return 'Enter the property street address.';
  if (d.city.trim() === '') return 'Enter the city.';
  if (!/^\d{5}(-\d{4})?$/.test(d.zip.trim())) return 'Enter a 5-digit ZIP code.';
  if (d.state.trim().length !== 2) return 'Enter a 2-letter state.';
  if (!d.repContactId) return 'Choose the representative this profile goes out under.';
  return null;
}

export function fullAddress(d: ConciergeDraft): string {
  return `${d.street.trim()}, ${d.city.trim()}, ${d.state.trim().toUpperCase()} ${d.zip.trim()}`;
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
export function generationBody(input: {
  draft: ConciergeDraft;
  preparedForName: string;
  preparedForCompany: string;
  allowDuplicate: boolean;
}): Record<string, unknown> {
  const { draft: d } = input;
  return {
    // No order here. The double-charge guard is keyed on the property.
    street: d.street.trim(),
    city: d.city.trim(),
    state: d.state.trim().toUpperCase(),
    zip: d.zip.trim(),
    preparedForName: input.preparedForName.trim(),
    preparedForCompany: input.preparedForCompany.trim() || null,
    // Which contact, never their name, email or phone.
    presentingRepContactId: d.repContactId,
    ...(input.allowDuplicate ? { allowDuplicate: true } : {}),
  };
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

// ─── The presenting-rep picker ──────────────────────────────────────────────

export interface RepResult {
  id: number;
  fullName: string | null;
  email: string | null;
  companyName: string | null;
}

export function RepPicker({ chosenName, results, query, searching, onQuery, onChoose, onClear }: {
  chosenName: string;
  results: RepResult[];
  query: string;
  searching: boolean;
  onQuery: (v: string) => void;
  onChoose: (r: RepResult) => void;
  onClear: () => void;
}) {
  if (chosenName) {
    return (
      <div className="flex items-center justify-between rounded-md border border-[#E5E5E5] px-3 py-2">
        <span className="text-[12px] text-[#171717]">{chosenName}</span>
        <button type="button" onClick={onClear} className="text-[11px] font-medium text-[#1B2A4A] hover:underline">
          Change
        </button>
      </div>
    );
  }
  return (
    <div>
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search sales representatives"
        className="w-full h-8 px-[9px] border border-[#E5E5E5] rounded-md text-[12px] outline-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange"
      />
      {query.trim().length >= 2 ? (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-[#EDEFF3]">
          {searching ? (
            <p className="px-3 py-2 text-[11.5px] text-[#9AA0AA]">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-[11.5px] text-[#9AA0AA]">No sales representative by that name.</p>
          ) : results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onChoose(r)}
              className="block w-full px-3 py-[6px] text-left text-[12px] text-[#171717] hover:bg-[#F5F7FB]"
            >
              {r.fullName ?? r.email ?? `Contact ${r.id}`}
              {r.companyName ? <span className="text-[#9AA0AA]"> · {r.companyName}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Step two: the property ─────────────────────────────────────────────────

export function ConciergeStep({ draft, problem, onField, repPicker }: {
  draft: ConciergeDraft;
  problem: string | null;
  onField: (k: keyof ConciergeDraft, v: string) => void;
  repPicker: React.ReactNode;
}) {
  const input = 'w-full h-8 px-[9px] border border-[#E5E5E5] rounded-md text-[12px] outline-none focus:ring-1 focus:ring-brand-orange/30 focus:border-brand-orange';
  return (
    <div className="space-y-3">
      <Field label="Street address">
        <input
          value={draft.street}
          onChange={(e) => onField('street', e.target.value)}
          placeholder="1358 5th St"
          className={input}
        />
      </Field>
      <div className="grid grid-cols-[1fr_70px_110px] gap-2">
        <Field label="City">
          <input value={draft.city} onChange={(e) => onField('city', e.target.value)} placeholder="La Verne" className={input} />
        </Field>
        <Field label="State">
          <input
            value={draft.state}
            onChange={(e) => onField('state', e.target.value.toUpperCase().slice(0, 2))}
            className={input}
          />
        </Field>
        <Field label="ZIP">
          <input value={draft.zip} onChange={(e) => onField('zip', e.target.value)} placeholder="91750" className={input} />
        </Field>
      </div>

      <Field label="Presenting representative">
        {repPicker}
        <p className="mt-1 text-[10.5px] text-[#9AA0AA]">
          The profile goes out under their name, with their phone and email on it.
        </p>
      </Field>

      <div className="rounded-md bg-[#FAFAFB] border border-[#EDEFF3] px-3 py-2">
        <p className="text-[10px] uppercase tracking-[0.09em] font-semibold text-[#9AA0AA]">Comparable criteria</p>
        <p className="text-[11.5px] text-[#3C4557]">{DEFAULT_CRITERIA_SUMMARY}</p>
        <p className="text-[10px] text-[#9AA0AA] mt-[2px]">Adjustable after it is generated — changing them is free.</p>
      </div>

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
          Generate a fresh one — 1 credit
        </button>
      </div>
    </div>
  );
}

// ─── The modal ──────────────────────────────────────────────────────────────

const EMPTY: ConciergeDraft = { street: '', city: '', state: 'CA', zip: '', repContactId: null, repName: '' };

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
  const [preparedForName, setPreparedForName] = useState('');
  const [preparedForCompany, setPreparedForCompany] = useState('');
  const [gateOpen, setGateOpen] = useState(false);
  const [spend, setSpend] = useState<{ thisMonth: number; allTime: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProblem, setShowProblem] = useState(false);
  const [existing, setExisting] = useState<{ existing: ExistingProfileNotice; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [freshRequested, setFreshRequested] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RepResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchCount = useRef(0);

  // Asked on every open, not cached: the flag can be turned on while the page
  // is sitting there, and a stale "not enabled" would hide a feature that works.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/concierge/access')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ConciergeAccess | null) => {
        if (!cancelled) setAccess(d ?? { canGenerate: false, featureOn: false });
      })
      .catch(() => { if (!cancelled) setAccess({ canGenerate: false, featureOn: false }); });
    return () => { cancelled = true; };
  }, []);

  const search = useCallback((v: string) => {
    setQuery(v);
    clearTimeout(debRef.current);
    if (v.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debRef.current = setTimeout(() => {
      const id = ++searchCount.current;
      fetch(`/api/contacts/search?type=sales_rep&pageSize=8&q=${encodeURIComponent(v.trim())}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d: { results?: RepResult[] }) => { if (id === searchCount.current) setResults(d.results ?? []); })
        .catch(() => { if (id === searchCount.current) setResults([]); })
        .finally(() => { if (id === searchCount.current) setSearching(false); });
    }, 250);
  }, []);

  const problem = draftProblem(draft);

  /**
   * Continue. Asks whether we already hold this property BEFORE the gate opens,
   * so the question is answered while deciding rather than after clicking a
   * button that spends. The server asks again; this is for the operator.
   */
  async function onContinue() {
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
    openGate();
  }

  function openGate() {
    setError(null);
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
   * Takes no arguments on purpose: the gate calls it from an onClick, which
   * would hand a MouseEvent to any parameter it had.
   */
  async function confirm() {
    setSubmitting(true); setError(null);
    try {
      const res = await fetch('/api/concierge/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generationBody({
          draft, preparedForName, preparedForCompany, allowDuplicate: freshRequested,
        })),
      });
      const body = await res.json().catch(() => null);
      if (body?.spend) setSpend(body.spend);
      if (!res.ok) {
        // A failure still left a row, and it may have cost a credit. Point the
        // operator at the list rather than back to a form that invites a second
        // click at the same property.
        setError(body?.error ?? `Generation failed (${res.status}).`);
        if (body?.profileId) onCreated(body.profileId as number);
        return;
      }
      onCreated(body.profileId as number);
      onClose();
    } catch {
      setError('Network error — the profile may or may not have been generated. Check the list before trying again.');
    } finally {
      setSubmitting(false);
    }
  }

  const options = typeOptions(access);

  return (
    <>
      <ModalShell
        open
        onClose={onClose}
        title="New Report"
        subtitle={step === 'type' ? 'Choose a type' : 'Concierge Profile'}
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
          ) : existing ? (
            <AlreadyHavePanel
              message={existing.message}
              existing={existing.existing}
              onOpen={() => {
                window.open(`/api/concierge/profiles/${existing.existing.id}/pdf`, '_blank');
                onClose();
              }}
              onFresh={() => { setFreshRequested(true); setExisting(null); openGate(); }}
            />
          ) : (
            <ConciergeStep
              draft={draft}
              problem={showProblem ? problem : null}
              onField={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
              repPicker={(
                <RepPicker
                  chosenName={draft.repName}
                  results={results}
                  query={query}
                  searching={searching}
                  onQuery={search}
                  onChoose={(r) => setDraft((d) => ({
                    ...d, repContactId: r.id, repName: r.fullName ?? r.email ?? `Contact ${r.id}`,
                  }))}
                  onClear={() => { setDraft((d) => ({ ...d, repContactId: null, repName: '' })); setQuery(''); setResults([]); }}
                />
              )}
            />
          )}

          {error && !gateOpen ? (
            <p className="mt-3 text-[11.5px] text-[#8E2A1E] bg-[#FDECEA] border border-[#F2C4BD] rounded-md px-3 py-2">
              {error}
            </p>
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
          {existing ? null : (
            <button
              type="button"
              disabled={(step === 'type' && selected === null) || checking}
              onClick={step === 'type' ? () => setStep('details') : onContinue}
              className="h-8 px-[13px] rounded-md text-[11.5px] font-semibold bg-[#1B2A4A] text-white hover:bg-[#243658] disabled:opacity-40"
            >
              {checking ? 'Checking…' : 'Continue'}
            </button>
          )}
        </div>
      </ModalShell>

      {/* MOUNTED ONLY WHILE OPEN, so the acknowledgement cannot survive a cancel
          and pre-arm the next generation. */}
      {gateOpen ? (
        <ConciergeCostGate
          address={fullAddress(draft)}
          preparedForName={preparedForName}
          preparedForCompany={preparedForCompany}
          presentingRepName={draft.repName}
          presentingRepProblem={null}
          criteriaSummary={DEFAULT_CRITERIA_SUMMARY}
          spend={spend}
          submitting={submitting}
          error={error}
          onPreparedForName={setPreparedForName}
          onPreparedForCompany={setPreparedForCompany}
          onCancel={() => { if (!submitting) { setGateOpen(false); setError(null); } }}
          onConfirm={confirm}
        />
      ) : null}
    </>
  );
}
