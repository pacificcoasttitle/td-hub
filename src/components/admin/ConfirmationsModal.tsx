'use client';

import { useEffect, useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface AttachedDoc { id: number; category: string; filename: string; sizeBytes: number }
interface EmailDetails {
  to: string[]; cc: string[]; subject: string; from: string;
  sentAt: string | null; deliveryStatus: 'sent' | 'failed' | 'pending';
}
interface Confirmation {
  id: number; eventType: string; status: string;
  createdAt: string; processedAt: string | null;
  emailDetails: EmailDetails | null; attachedDocuments: AttachedDoc[];
}
interface ConfirmationsResponse { confirmations: Confirmation[]; orderEmailStatus: string }

interface Props { orderId: number; fileNumber: string; open: boolean; onClose: () => void }

/* ── Constants ─────────────────────────────────────────────────────────────── */

const BANNER: Record<string, { cls: string; text: string }> = {
  sent:          { cls: 'bg-green-50 border-green-200 text-green-800', text: 'Confirmation Sent Successfully' },
  pending:       { cls: 'bg-amber-50 border-amber-200 text-amber-800', text: 'Confirmation Pending' },
  failed:        { cls: 'bg-red-50 border-red-200 text-red-800',       text: 'Confirmation Failed' },
  no_recipients: { cls: 'bg-gray-50 border-gray-200 text-gray-600',    text: 'No Recipients Available' },
};

const CAT_BADGE: Record<string, [string, string]> = {
  legal_vesting: ['Legal Vesting', 'bg-blue-100 text-blue-700'],
  tax:           ['Tax',           'bg-green-100 text-green-700'],
  grant_deed:    ['Grant Deed',    'bg-amber-100 text-amber-700'],
  cpl:           ['CPL',           'bg-purple-100 text-purple-700'],
  proposed_insured: ['Proposed Insured', 'bg-teal-100 text-teal-700'],
};

const STATUS_CLS: Record<string, string> = {
  processed: 'bg-green-100 text-green-800',
  sent:      'bg-green-100 text-green-800',
  pending:   'bg-amber-100 text-amber-800',
  failed:    'bg-red-100 text-red-800',
};

/* ── Modal ─────────────────────────────────────────────────────────────────── */

export function ConfirmationsModal({ orderId, fileNumber, open, onClose }: Props) {
  const [data, setData] = useState<ConfirmationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) { setData(null); setError(null); return; }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/orders/${orderId}/confirmations`, { signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); })
      .then(setData)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [open, orderId]);

  if (!open) return null;

  const latest = data?.confirmations?.[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-[#1A1A2E]">Confirmations — {fileNumber}</h2>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A1A2E] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {loading && <Skeleton />}
          {error && (
            <div className="text-center py-10">
              <p className="text-red-600 font-medium">Failed to load confirmation details</p>
              <p className="text-sm text-[#6B7280] mt-1">Order ID: {orderId}</p>
            </div>
          )}
          {!loading && !error && data && (
            data.confirmations.length === 0
              ? <EmptyState />
              : <>
                  <StatusBanner status={data.orderEmailStatus} />
                  {latest?.emailDetails && <RecipientsSection details={latest.emailDetails} />}
                  {!latest?.emailDetails && (
                    <div className="mb-5"><SH>Recipients</SH><p className="text-sm text-gray-400">No recipient details recorded</p></div>
                  )}
                  <DocumentsSection docs={latest?.attachedDocuments ?? []} />
                  {data.confirmations.length > 1 && <Timeline entries={data.confirmations} />}
                </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Status Banner ─────────────────────────────────────────────────────────── */

function StatusBanner({ status }: { status: string }) {
  const info = BANNER[status] ?? BANNER.pending;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm font-medium mb-5 ${info.cls}`}>
      {info.text}
    </div>
  );
}

/* ── Recipients ────────────────────────────────────────────────────────────── */

function RecipientsSection({ details }: { details: EmailDetails }) {
  const hasTo = details.to.length > 0;
  const hasCc = details.cc.length > 0;
  if (!hasTo && !hasCc) {
    return <div className="mb-5"><SH>Recipients</SH><p className="text-sm text-gray-400">No recipient details recorded</p></div>;
  }
  return (
    <div className="mb-5">
      <SH>Recipients</SH>
      {hasTo && (
        <div className="mb-2">
          <span className="text-sm font-medium text-gray-700">To:</span>
          {details.to.map((email, i) => <p key={i} className="text-sm text-gray-900 ml-6">{email}</p>)}
        </div>
      )}
      {hasCc && (
        <div>
          <span className="text-sm font-medium text-gray-500">CC:</span>
          {details.cc.map((email, i) => <p key={i} className="text-sm text-gray-500 ml-6">{email}</p>)}
        </div>
      )}
    </div>
  );
}

/* ── Attached Documents ────────────────────────────────────────────────────── */

function DocumentsSection({ docs }: { docs: AttachedDoc[] }) {
  return (
    <div className="mb-5">
      <SH>Attached Documents</SH>
      {docs.length === 0 ? (
        <p className="text-sm text-gray-400">No documents were attached to this confirmation</p>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => {
            const [label, cls] = CAT_BADGE[doc.category] ?? [doc.category.replace(/_/g, ' '), 'bg-gray-100 text-gray-600'];
            return (
              <div key={doc.id} className="flex items-center gap-3">
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium capitalize shrink-0 ${cls}`}>{label}</span>
                <span className="text-sm text-[#1A1A2E] truncate">{doc.filename}</span>
                <span className="text-sm text-gray-500 shrink-0 ml-auto">{fmtSize(doc.sizeBytes)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Timeline ──────────────────────────────────────────────────────────────── */

function Timeline({ entries }: { entries: Confirmation[] }) {
  const sorted = [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return (
    <div>
      <SH>History</SH>
      <div className="space-y-2.5">
        {sorted.map(entry => {
          const recipientCount = entry.emailDetails?.to.length ?? 0;
          const stCls = STATUS_CLS[entry.status] ?? 'bg-gray-100 text-gray-600';
          return (
            <div key={entry.id} className="flex items-center gap-3 text-sm">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize shrink-0 ${stCls}`}>
                {entry.status}
              </span>
              <span className="text-gray-600">
                {recipientCount > 0 ? `Sent to ${recipientCount} recipient${recipientCount !== 1 ? 's' : ''}` : entry.eventType?.replace(/_/g, ' ') || '—'}
              </span>
              <span className="text-gray-400 text-xs ml-auto whitespace-nowrap" title={fmtAbsolute(entry.createdAt)}>
                {fmtRelative(entry.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="text-center py-12">
      <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      <p className="text-sm text-gray-500">No confirmation has been sent for this order yet.</p>
    </div>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────────────── */

function Skeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-12 bg-gray-100 rounded-lg" />
      <div><div className="h-3 w-20 bg-gray-200 rounded mb-2" /><div className="h-4 w-48 bg-gray-100 rounded mb-1" /><div className="h-4 w-40 bg-gray-100 rounded" /></div>
      <div><div className="h-3 w-32 bg-gray-200 rounded mb-2" /><div className="h-4 w-full bg-gray-100 rounded mb-1.5" /><div className="h-4 w-3/4 bg-gray-100 rounded" /></div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function SH({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{children}</h4>;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function fmtAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}
