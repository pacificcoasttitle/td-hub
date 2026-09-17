'use client';

import { useEffect, useState } from 'react';
import type { HubListOrder } from '@/lib/domain/orders/hub-list-row';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';
import { summariseCriteria } from '@/lib/domain/concierge/criteria-summary';
import { ConciergeCostGate } from './concierge-cost-gate';
import { ConciergeCriteriaPanel } from './concierge-criteria-panel';
import { useConciergeProfile, type ConciergeAccess } from './use-concierge-profile';

// ─── The property profile, on the ORDER PANE ────────────────────────────────
//
// Not in the Documents panel. Everything there is a document we already hold or
// can fetch for nothing; this one spends a credit, and a paid action sitting in
// a row of free ones is how somebody clicks it expecting a download.
//
// What is drawn here decides nothing. `/api/concierge/access` answers on the
// server (role AND feature flag), every route re-checks, and the only call that
// can spend is Generate behind the cost gate.

const CARD = 'bg-white border border-[#EEF0F4] rounded-[9px]';

export function ConciergeProfilePanel({ order }: { order: HubListOrder }) {
  const [access, setAccess] = useState<ConciergeAccess>({ canGenerate: false, featureOn: false });
  const [preparedForName, setPreparedForName] = useState(order.clientName ?? '');
  const [preparedForCompany, setPreparedForCompany] = useState(order.clientCompany ?? '');

  useEffect(() => {
    let live = true;
    fetch('/api/concierge/access')
      .then((r) => (r.ok ? r.json() : null))
      .then((a: ConciergeAccess | null) => { if (live && a) setAccess(a); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // The prepared-for defaults follow the selected order, not the first one seen.
  useEffect(() => {
    setPreparedForName(order.clientName ?? '');
    setPreparedForCompany(order.clientCompany ?? '');
  }, [order.id, order.clientName, order.clientCompany]);

  const c = useConciergeProfile(order.id, access);

  // Hidden entirely when the feature is off or the role cannot generate: an
  // operator who can never use it should not be told it exists.
  if (!access.featureOn || !access.canGenerate) return null;

  const addressMissing = !order.propertyStreet || !order.propertyCity || !order.propertyZip;
  const address = [order.propertyStreet, [order.propertyCity, order.propertyState].filter(Boolean).join(', '), order.propertyZip]
    .filter(Boolean).join(' ');
  const p = c.profile;

  return (
    <>
      <ConciergeProfileCard
        profile={p}
        loading={c.loading}
        busy={c.busy}
        error={c.error}
        addressMissing={addressMissing}
        onGenerate={c.openGate}
        onAdjust={c.openCriteria}
        onRerender={c.retryRender}
      />

      {/* Mounted only while open, so each open starts from fresh state. */}
      {c.gateOpen ? (
        <ConciergeCostGate
          address={address}
          preparedForName={preparedForName}
          preparedForCompany={preparedForCompany}
          presentingRepName={c.presentingRep?.name ?? ''}
          presentingRepProblem={c.presentingRepProblem}
          criteriaSummary={summariseCriteria()}
          spend={c.spend}
          submitting={c.busy}
          error={c.error}
          onPreparedForName={setPreparedForName}
          onPreparedForCompany={setPreparedForCompany}
          onCancel={c.closeGate}
          onConfirm={() => c.generate({
            orderId: order.id,
            street: order.propertyStreet ?? '',
            city: order.propertyCity ?? '',
            state: order.propertyState ?? 'CA',
            zip: order.propertyZip ?? '',
            preparedForName,
            preparedForCompany: preparedForCompany || null,
          })}
        />
      ) : null}

      {c.criteriaOpen && p ? (
        <ConciergeCriteriaPanel
          profile={p}
          busy={c.busy}
          error={c.error}
          onClose={c.closeCriteria}
          onApply={c.adjust}
        />
      ) : null}
    </>
  );
}

/**
 * What is drawn, with no fetching of its own — so a test can render each state
 * and read what an operator would see. The container above decides access.
 */
export function ConciergeProfileCard({
  profile: p, loading, busy, error, addressMissing, onGenerate, onAdjust, onRerender,
}: {
  profile: ProfileSummary | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  addressMissing: boolean;
  onGenerate: () => void;
  onAdjust: () => void;
  onRerender: () => void;
}) {
  return (
    <section className={CARD}>
      <header className="flex items-center justify-between px-[14px] py-[10px] border-b border-[#F1F2F5]">
        <h3 className="text-[11px] font-semibold tracking-[0.6px] uppercase text-[#6B7280]">Property profile</h3>
        {p?.creditsCharged ? (
          <span className="text-[11px] text-[#8A9099]">{p.creditsCharged} credit{p.creditsCharged === 1 ? '' : 's'} spent</span>
        ) : null}
      </header>

      <div className="px-[14px] py-[12px] text-[12px] text-[#3C4149]">
        {loading && !p ? <span className="text-[#B5B9C0]">Checking…</span> : null}

        {!loading && !p ? (
          <div className="flex items-center justify-between gap-[12px]">
            <span className="text-[#6B7280]">
              {addressMissing
                ? 'Needs a street, city and ZIP on the order before a profile can be run.'
                : 'No profile yet. Generating one costs a credit.'}
            </span>
            <button
              type="button"
              disabled={addressMissing || busy}
              onClick={onGenerate}
              className="shrink-0 px-[10px] py-[6px] rounded-[6px] text-[12px] font-medium border border-[#D9DDE3] bg-white hover:bg-[#F7F8FA] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Generate property profile
            </button>
          </div>
        ) : null}

        {p ? (
          <div className="flex flex-col gap-[8px]">
            <div className="flex items-center justify-between gap-[12px]">
              <span>
                {p.status === 'failed'
                  ? <span className="text-[#B03A2C]">Generation failed — {p.errorMessage ?? 'no reason recorded'}</span>
                  : <>{p.subjectAddressLine ?? p.requestedAddress} · {p.compsShown} of {p.compsQualified} comparables shown</>}
              </span>
              <div className="flex items-center gap-[8px] shrink-0">
                {p.hasPdf ? (
                  <a
                    href={`/api/concierge/profiles/${p.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-[10px] py-[6px] rounded-[6px] text-[12px] font-medium border border-[#D9DDE3] bg-white hover:bg-[#F7F8FA]"
                  >
                    Open PDF
                  </a>
                ) : null}
                {p.status !== 'failed' ? (
                  <button
                    type="button"
                    onClick={onAdjust}
                    disabled={busy}
                    className="px-[10px] py-[6px] rounded-[6px] text-[12px] font-medium border border-[#D9DDE3] bg-white hover:bg-[#F7F8FA] disabled:opacity-40"
                  >
                    Adjust comparables — free
                  </button>
                ) : null}
                {p.canRenderFree && !p.hasPdf ? (
                  <button
                    type="button"
                    onClick={onRerender}
                    disabled={busy}
                    className="px-[10px] py-[6px] rounded-[6px] text-[12px] font-medium border border-[#D9DDE3] bg-white hover:bg-[#F7F8FA] disabled:opacity-40"
                  >
                    Re-render — free
                  </button>
                ) : null}
              </div>
            </div>
            <span className="text-[11px] text-[#8A9099]">{summariseCriteria(p.criteria)}</span>
          </div>
        ) : null}

        {error ? <p className="mt-[8px] text-[11px] text-[#B03A2C]">{error}</p> : null}
      </div>
    </section>
  );
}
