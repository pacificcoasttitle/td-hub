'use client';

import React, { useState, useRef, useEffect } from 'react';

/* ── Document Badge Types ──────────────────────────────────────────────────── */

export interface DocCatFull { exists: boolean; count: number; latestId: number | null; latestCreatedAt: string | null }
interface DocCatBool { exists: boolean }
export interface OrderDocuments {
  cpl: DocCatFull; prelim: DocCatFull; proposedInsured: DocCatFull;
  legalVesting: DocCatBool; tax: DocCatBool; grantDeed: DocCatBool;
}

const DOC_BADGE_CONFIG: { key: keyof OrderDocuments; label: string; bg: string; text: string }[] = [
  { key: 'cpl',             label: 'CPL', bg: 'bg-purple-100', text: 'text-purple-700' },
  { key: 'prelim',          label: 'Prelim', bg: 'bg-blue-100', text: 'text-blue-700' },
  { key: 'proposedInsured', label: 'PI',  bg: 'bg-teal-100',   text: 'text-teal-700' },
  { key: 'legalVesting',    label: 'LV',  bg: 'bg-blue-100',   text: 'text-blue-700' },
  { key: 'tax',             label: 'Tax', bg: 'bg-green-100',  text: 'text-green-700' },
  { key: 'grantDeed',       label: 'GD',  bg: 'bg-amber-100',  text: 'text-amber-700' },
];

function fmtDocDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

export function DocBadges({ docs }: { docs?: OrderDocuments }) {
  if (!docs) return null;
  const badges = DOC_BADGE_CONFIG.filter(({ key }) => docs[key]?.exists);
  if (badges.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 ml-2">
      {badges.map(({ key, label, bg, text }) => {
        const cat = docs[key];
        const date = 'latestCreatedAt' in cat ? fmtDocDate((cat as DocCatFull).latestCreatedAt) : '';
        const tip = date ? `${label} generated ${date}` : `${label} generated`;
        return <span key={key} title={tip} className={`${bg} ${text} text-xs px-1.5 py-0.5 rounded-full font-medium cursor-default`}>{label}</span>;
      })}
    </span>
  );
}

/* ── Status Helpers ────────────────────────────────────────────────────────── */

export const STATUS_OPTS = ['', 'open', 'in_process', 'closed', 'cancelled'];
export const STATUS_LABELS: Record<string, string> = { open: 'Open', in_process: 'In Process', closed: 'Closed', cancelled: 'Cancelled' };
export const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  in_process: 'bg-amber-50 text-amber-700 border-amber-200',
  closed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

export function TH({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <th className={`${center ? 'text-center' : 'text-left'} px-4 py-3 font-semibold text-[#6B7280] uppercase tracking-wide text-xs`}>{children}</th>;
}

export function StatusBadge({ status }: { status: string | null }) {
  const s = status?.toLowerCase() ?? '';
  const color = STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-500 border-gray-200';
  const label = STATUS_LABELS[s] ?? status ?? '—';
  return <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap ${color}`}>{label}</span>;
}

export function ActionBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title} className="w-8 h-8 rounded-md flex items-center justify-center text-[#6B7280] hover:bg-[#F26B2B]/10 hover:text-[#F26B2B] transition-colors">
      {icon === 'cpl' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
      {icon === 'prelim' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
      {icon === 'proposed' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
      {icon === 'notes' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>}
      {icon === 'detail' && <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
    </button>
  );
}

/* ── Actions Dropdown ──────────────────────────────────────────────────────── */

export interface ActionsDropdownProps {
  orderId: number;
  hasProperty: boolean;
  softproStatus?: string | null;
  operationalStatus?: string | null;
  documents?: OrderDocuments;
  actions: string[];
  isClient: boolean;
  onOpenModal: (type: string) => void;
  feesHref?: string;
  onRefresh?: () => void;
}

function MenuItem({ label, onClick, disabled, tooltip }: {
  label: string; onClick?: () => void; disabled?: boolean; tooltip?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={tooltip}
      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
        disabled
          ? 'text-gray-300 cursor-not-allowed'
          : 'text-[#1A1A2E] hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-gray-100" />;
}

export function ActionsDropdown({
  orderId, hasProperty, softproStatus, operationalStatus, documents, actions, isClient, onOpenModal, feesHref, onRefresh,
}: ActionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'resync' | 'retry_tp' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasCpl = !!documents?.cpl?.exists;
  const hasPrelim = !!documents?.prelim?.exists;
  const hasPI = !!documents?.proposedInsured?.exists;
  const cplId = hasCpl ? (documents!.cpl as DocCatFull).latestId : null;
  const piId = hasPI ? (documents!.proposedInsured as DocCatFull).latestId : null;
  const dlBase = isClient ? '/api/client' : '/api';
  const statusForDelivery = (softproStatus ?? operationalStatus ?? '').toLowerCase().trim();
  const canDeliverPrelim = hasPrelim && !['canceled', 'cancelled', 'duplicate'].includes(statusForDelivery);

  function act(fn: () => void) { fn(); setOpen(false); }

  async function inlineAction(type: 'resync' | 'retry_tp') {
    setBusy(type);
    try {
      const url = type === 'resync'
        ? `/api/orders/${orderId}/resync`
        : `/api/orders/${orderId}/titlepoint/retry`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        alert(body.error ?? 'Request failed');
      }
    } catch {
      alert('Network error — please try again');
    } finally {
      setBusy(null);
      setOpen(false);
      onRefresh?.();
    }
  }

  const showCpl = actions.includes('cpl');
  const showPI = actions.includes('proposed');
  const showPrelim = actions.includes('prelim');
  const showDeliverPrelim = actions.includes('deliver_prelim') && canDeliverPrelim;
  const showNotes = actions.includes('notes');
  const showDetail = actions.includes('detail');
  const showFees = actions.includes('fees') && !!feesHref;
  const showResync = actions.includes('resync');
  const showRetryTp = actions.includes('retry_tp');
  const hasOpsActions = showResync || showRetryTp;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-md flex items-center justify-center text-[#6B7280] hover:bg-gray-100 transition-colors text-lg font-bold leading-none"
        title="Actions"
      >
        ⋮
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          {showDetail && <MenuItem label="View Order" onClick={() => act(() => onOpenModal('detail'))} />}

          {(showCpl || showPI) && showDetail && <Divider />}

          {showCpl && (
            hasCpl ? (
              <>
                <MenuItem label="View CPL" onClick={() => act(() => window.open(`${dlBase}/documents/${cplId}/download`, '_blank'))} />
                <MenuItem label="Regenerate CPL" onClick={() => act(() => onOpenModal('cpl'))} />
              </>
            ) : (
              <MenuItem
                label="Generate CPL"
                disabled={!hasProperty}
                tooltip={!hasProperty ? 'Property address required for CPL' : undefined}
                onClick={() => act(() => onOpenModal('cpl'))}
              />
            )
          )}

          {showCpl && showPI && <Divider />}

          {showPI && (
            hasPI ? (
              <>
                <MenuItem label="View Proposed Insured" onClick={() => act(() => window.open(`${dlBase}/documents/${piId}/download`, '_blank'))} />
                <MenuItem label="Regenerate Proposed Insured" onClick={() => act(() => onOpenModal('proposed'))} />
              </>
            ) : (
              <MenuItem label="Generate Proposed Insured" onClick={() => act(() => onOpenModal('proposed'))} />
            )
          )}

          {(showPrelim || showDeliverPrelim || showNotes || showFees) && (showCpl || showPI) && <Divider />}

          {showPrelim && <MenuItem label="Find Prelim" onClick={() => act(() => onOpenModal('prelim'))} />}
          {showDeliverPrelim && <MenuItem label="Deliver Prelim" onClick={() => act(() => onOpenModal('deliver_prelim'))} />}
          {showNotes && <MenuItem label="Order Notes" onClick={() => act(() => onOpenModal('notes'))} />}
          {showFees && <MenuItem label="Fee Estimate" onClick={() => act(() => { window.location.href = feesHref!; })} />}

          {hasOpsActions && <Divider />}

          {showRetryTp && (
            <MenuItem
              label={busy === 'retry_tp' ? 'Retrying…' : 'Retry TitlePoint'}
              disabled={busy !== null}
              onClick={() => inlineAction('retry_tp')}
            />
          )}
          {showResync && (
            <MenuItem
              label={busy === 'resync' ? 'Syncing…' : 'Resync from SoftPro'}
              disabled={busy !== null}
              onClick={() => inlineAction('resync')}
            />
          )}
        </div>
      )}
    </div>
  );
}
