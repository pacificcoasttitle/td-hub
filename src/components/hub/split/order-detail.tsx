'use client';

import {
  clientLabel, describeMissing, fullAddress, fullDateTime, missingFields, timeOfDay,
  type HubListOrder,
} from '@/lib/domain/orders/hub-list-row';
import { statusBadge } from '@/lib/domain/orders/status-format';
import { DocumentsPanel, type DocState } from './documents-panel';
import type { ProfileSummary } from '@/lib/domain/concierge/profiles';

// ─── Read-only detail pane ───────────────────────────────────────────────────
//
// Header, the two conditional banners, the Documents panel and the Order field
// grid. Contacts and Notes remain absent rather than stubbed — an empty panel
// outline promises data that is not there.
//
// Everything here is rendered from the list row. There is no per-order fetch,
// which is what makes j/k feel instant: the pane cannot lag the selection
// because it is the selection.

export interface OrderDetailProps {
  order: HubListOrder | null;
  busy: 'resync' | 'retry_tp' | null;
  onResync: (o: HubListOrder) => void;
  onRetryTitlePoint: (o: HubListOrder) => void;
  documents?: { cpl?: DocState; prelim?: DocState; proposedInsured?: DocState };
  profile: ProfileSummary | null;
  profileLoading: boolean;
  profileBusy: boolean;
  canGenerateProfile: boolean;
  profileFeatureOn: boolean;
  onGenerateProfile: () => void;
  onAdjustProfile: () => void;
  onRetryProfileRender: () => void;
  onGenerateDocument: (kind: 'cpl' | 'proposed' | 'prelim') => void;
}

export function OrderDetail({
  order, busy, onResync, onRetryTitlePoint, ...d
}: OrderDetailProps) {
  if (!order) {
    return (
      <div className="flex-1 min-w-0 bg-[#FAFAFB] flex items-center justify-center">
        <span className="text-[12px] text-[#B5B9C0]">Pick an order from the list</span>
      </div>
    );
  }

  const missing = missingFields(order);
  const failed = order.syncStatus === 'failed';
  const address = fullAddress(order);
  const status = statusBadge(order.operationalStatus);

  return (
    <div className="flex-1 min-w-0 bg-[#FAFAFB] flex flex-col min-h-0">
      {/* header — 62px, sticky by construction: it is outside the scroll area */}
      <div className="h-[62px] shrink-0 bg-white border-b border-[#E5E5E5] px-5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1
            className="text-[18px] font-semibold tracking-[-0.015em] leading-[1.2] truncate"
            style={{ color: '#171717' }}
          >
            {address ?? 'Address pending'}
          </h1>
          <div className="text-[12px] text-[#6B7280] truncate mt-[2px]">
            <span className="font-mono">{order.fileNumber}</span>
            <Sep />
            {order.transactionType
              ? <span>{order.transactionType}</span>
              : <span className="text-[#B4620B]">type not set</span>}
            {order.county && <><Sep /><span>{order.county} County</span></>}
            {order.openedAtIso && <><Sep /><span>opened {timeOfDay(order.openedAtIso)}</span></>}
          </div>
        </div>
        <span className={`shrink-0 text-[10.5px] font-semibold px-[9px] py-[3px] rounded-full border ${status.color}`}>
          {status.label}
        </span>
        <span className="shrink-0 text-[11px] flex items-center gap-[5px]"
          style={{ color: failed ? '#B03A2C' : '#6B7280' }}>
          <span className="w-[6px] h-[6px] rounded-full"
            style={{ background: failed ? '#D6503F' : '#3FA97C' }} aria-hidden />
          {failed ? 'Sync failed' : 'Synced'}
        </span>
      </div>

      {/* scroll area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-3 pb-[10px] flex flex-col gap-[10px]">
        {failed && (
          <Banner tone="error">
            <div className="flex items-start gap-2">
              <span aria-hidden>⚠</span>
              <div className="flex-1">
                <p>
                  The last SoftPro or TitlePoint call for this order failed and nothing has
                  succeeded since — it may be missing fields from the source system.
                </p>
                <div className="flex gap-2 mt-2">
                  <SmallButton disabled={busy !== null} onClick={() => onRetryTitlePoint(order)}>
                    {busy === 'retry_tp' ? 'Retrying…' : 'Retry TitlePoint'}
                  </SmallButton>
                  <SmallButton disabled={busy !== null} onClick={() => onResync(order)}>
                    {busy === 'resync' ? 'Syncing…' : 'Resync from SoftPro'}
                  </SmallButton>
                </div>
              </div>
            </div>
          </Banner>
        )}

        {missing.length > 0 && (
          <Banner tone="warning">
            <div className="flex items-center gap-3">
              <span className="flex-1">Incomplete — {describeMissing(missing)}.</span>
              {/* The spec asks for [Open in SoftPro]. SoftPro is reachable here only
                  as an API — there is no user-facing URL to deep-link into, and a
                  fabricated one would 404 on the first click. Re-pulling from the
                  source is the action that actually fills a missing field. */}
              <SmallButton disabled={busy !== null} onClick={() => onResync(order)}>
                {busy === 'resync' ? 'Syncing…' : 'Resync from SoftPro'}
              </SmallButton>
            </div>
          </Banner>
        )}

        <DocumentsPanel
          documents={d.documents}
          profile={d.profile}
          profileLoading={d.profileLoading}
          canGenerateProfile={d.canGenerateProfile}
          profileFeatureOn={d.profileFeatureOn}
          busyProfile={d.profileBusy}
          onGenerateProfile={d.onGenerateProfile}
          onAdjustProfile={d.onAdjustProfile}
          onRetryProfileRender={d.onRetryProfileRender}
          onGenerate={d.onGenerateDocument}
        />

        <Panel label="Order">
          <div className="grid grid-cols-4 gap-y-[10px] gap-x-[22px]">
            <Field label="Client" value={clientLabel(order)} />
            <Field label="Firm" value={order.clientCompany} />
            <Field label="APN" value={order.apn} mono />
            <Field label="County" value={order.county} />
            <Field label="Order type" value={order.transactionType} />
            <Field label="Status" value={status.label} />
            <Field label="Opened" value={fullDateTime(order.openedAtIso)} />
            <Field
              label="SoftPro"
              value={failed ? 'Failed' : 'Synced'}
              valueColor={failed ? '#B03A2C' : undefined}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Sep() {
  return <span className="mx-[6px] text-[#C9CDD4]">·</span>;
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#E9EAEE] rounded-[9px]">
      <header className="h-7 flex items-center px-[13px] border-b border-[#F0F1F3]">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9AA0AA]">{label}</h2>
      </header>
      <div className="px-[13px] py-[9px]">{children}</div>
    </section>
  );
}

/** Unset reads "Not set" in a lighter grey — never an em-dash. */
function Field({
  label, value, mono, valueColor,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  valueColor?: string;
}) {
  const has = value != null && value.trim() !== '';
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-[#9AA0AA]">{label}</div>
      <div
        className={`text-[12.5px] truncate ${mono && has ? 'font-mono' : ''}`}
        style={{ color: valueColor ?? (has ? '#171717' : '#B5B9C0') }}
        title={has ? value! : undefined}
      >
        {has ? value : 'Not set'}
      </div>
    </div>
  );
}

const BANNER_TONE = {
  error: 'bg-[#FDECEA] border-[#F2C4BD] text-[#8E2A1E]',
  warning: 'bg-[#FDF4E7] border-[#EFD9AE] text-[#B4620B]',
} as const;

function Banner({ tone, children }: { tone: keyof typeof BANNER_TONE; children: React.ReactNode }) {
  return (
    <div className={`border rounded-[9px] px-[13px] py-[9px] text-[12px] ${BANNER_TONE[tone]}`}>
      {children}
    </div>
  );
}

function SmallButton({
  onClick, children, disabled,
}: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-6 px-[9px] rounded-[5px] bg-white border border-current/25 text-[11px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-brand-orange/30 hover:bg-white/70 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
