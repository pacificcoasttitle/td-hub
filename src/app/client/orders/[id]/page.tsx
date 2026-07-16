'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { OrderTimeline } from '@/components/client/order-timeline';
import { DocumentsTab } from '@/components/client/order-detail/documents-tab';
import { formatDate as fmtDate, getStatusStyle } from '@/components/client/order-detail/helpers';
import { ActivityFeed } from '@/components/shared/activity-feed';
import { formatOrderAddress } from '@/lib/domain/orders/order-format';

interface Document {
  id: number;
  filename: string;
  category: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

interface OrderDetail {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  transactionType: string | null;
  openedAt: string | null;
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
    zip?: string | null;
    county: string | null;
    fullAddress: string | null;
  } | null;
  documents: Document[];
}

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'documents', label: 'Documents' },
  { id: 'cpl', label: 'CPL' },
  { id: 'prelim', label: 'Prelim' },
  { id: 'fees', label: 'Fees' },
  { id: 'notes', label: 'Notes' },
  { id: 'activity', label: 'Activity' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type ClientOrderDocument = { id: number; filename: string; createdAt: string; category: string | null };

const SKELETON_LINE_WIDTHS = ['68%', '52%', '74%', '46%', '61%'];

export default function ClientOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (tabParam && TABS.some((t) => t.id === tabParam)) return tabParam as TabId;
    return 'timeline';
  });

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (tabParam && TABS.some((t) => t.id === tabParam)) setActiveTab(tabParam as TabId);
    }, 0);
    return () => clearTimeout(timeout);
  }, [tabParam]);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/client/orders/${params.id}`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : Promise.reject('Order not found'))
      .then((d) => setOrder(d))
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(typeof err === 'string' ? err : 'Failed to load order');
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [params.id]);

  if (loading) return <DetailSkeleton />;

  if (error || !order) {
    return (
      <div>
        <Link href="/client/dashboard" className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#1B2A4A] mb-6 transition-colors min-h-[44px]">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back to Files
        </Link>
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-12 text-center">
          <p className="text-[#1B2A4A] font-medium">{error ?? 'Order not found'}</p>
          <Link href="/client/dashboard" className="text-sm text-[#F26B2B] hover:underline mt-2 inline-block">Return to dashboard</Link>
        </div>
      </div>
    );
  }

  const addr = formatOrderAddress(order.property);
  const status = getStatusStyle(order.operationalStatus);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back */}
      <Link href="/client/dashboard" className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#1B2A4A] mb-6 transition-colors min-h-[44px]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back to Files
      </Link>

      {/* Header Card */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <span className="font-mono text-sm text-[#4B5563] tracking-wide">{order.fileNumber}</span>
            <h1 className="text-xl sm:text-2xl font-semibold text-[#1B2A4A] mt-1">
              {addr === '—' ? 'Property details pending' : addr}
            </h1>
          </div>
          <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium flex-shrink-0 border ${status.className}`}>
            {status.label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm text-[#4B5563]">
          {order.transactionType && (
            <span className="font-medium text-[#1B2A4A] capitalize">{order.transactionType.replace(/_/g, ' ')}</span>
          )}
          {order.openedAt && (
            <div className="flex items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              Opened {fmtDate(order.openedAt)}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#E5E7EB] mb-6 overflow-x-auto">
        <nav className="flex items-center gap-6 sm:gap-8 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative pb-3.5 text-sm font-medium transition-colors whitespace-nowrap min-h-[44px] sm:min-h-0 ${
                activeTab === tab.id ? 'text-[#F26B2B]' : 'text-[#4B5563] hover:text-[#1B2A4A]'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#F26B2B]" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="pb-12">
        {activeTab === 'timeline' && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
            <OrderTimeline orderId={order.id} />
          </div>
        )}
        {activeTab === 'documents' && (
          <DocumentsTab documents={order.documents} orderId={order.id} />
        )}
        {activeTab === 'cpl' && <CplTabContent orderId={order.id} />}
        {activeTab === 'prelim' && <PrelimTabContent orderId={order.id} />}
        {activeTab === 'fees' && <FeesTabContent orderId={order.id} />}
        {activeTab === 'notes' && <NotesTabContent orderId={order.id} />}
        {activeTab === 'activity' && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <ActivityFeed fetchUrl={`/api/client/orders/${order.id}/activity`} accentColor="#F26B2B" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Inline CPL Tab ───────────────────────────────────────────────────────── */

function CplTabContent({ orderId }: { orderId: number }) {
  const [docs, setDocs] = useState<{ id: number; filename: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/client/orders/${orderId}/documents`).then((r) => r.ok ? r.json() : { documents: [] })
      .then((d) => setDocs(((d.documents ?? []) as ClientOrderDocument[]).filter((doc) => doc.category === 'cpl')))
      .catch(() => {}).finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 animate-pulse"><div className="h-6 w-48 bg-gray-100 rounded mb-4" /><div className="h-4 w-64 bg-gray-100 rounded" /></div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-6">
        <h3 className="font-semibold text-[#1B2A4A] mb-2">Closing Protection Letter</h3>
        {docs.length > 0 ? (
          <div className="space-y-3 mb-4">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 p-3 bg-[#FAFAFA] rounded-lg">
                <div>
                  <p className="text-sm font-medium text-[#1B2A4A]">{d.filename}</p>
                  <p className="text-xs text-[#6B7280]">{fmtDate(d.createdAt)}</p>
                </div>
                <a href={`/api/documents/${d.id}/download`} className="px-4 py-2 text-sm font-medium border border-[#F26B2B] text-[#F26B2B] rounded-lg hover:bg-[#F26B2B]/5 transition-colors">Download</a>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#4B5563] mb-4">No CPL has been generated for this order yet.</p>
        )}
        <Link href={`/client/orders/${orderId}/cpl`} className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] transition-colors">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          Generate CPL
        </Link>
      </div>
    </div>
  );
}

/* ─── Inline Prelim Tab ────────────────────────────────────────────────────── */

function PrelimTabContent({ orderId }: { orderId: number }) {
  const [docs, setDocs] = useState<{ id: number; filename: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/client/orders/${orderId}/documents`).then((r) => r.ok ? r.json() : { documents: [] })
      .then((d) => setDocs(((d.documents ?? []) as ClientOrderDocument[]).filter((doc) => doc.category === 'prelim')))
      .catch(() => {}).finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 animate-pulse"><div className="h-6 w-48 bg-gray-100 rounded mb-4" /><div className="h-4 w-64 bg-gray-100 rounded" /></div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-6">
        <h3 className="font-semibold text-[#1B2A4A] mb-2">Preliminary Title Report</h3>
        {docs.length > 0 ? (
          <div className="space-y-3 mb-4">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-4 p-4 bg-[#FAFAFA] rounded-lg">
                <div className="flex-shrink-0 p-3 bg-[#DBEAFE] rounded-lg">
                  <svg className="h-5 w-5 text-[#1E40AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[#1B2A4A] truncate">{d.filename}</p>
                  <p className="text-xs text-[#6B7280]">{fmtDate(d.createdAt)}</p>
                </div>
                <a href={`/api/documents/${d.id}/download`} className="px-4 py-2 text-sm font-medium border border-[#F26B2B] text-[#F26B2B] rounded-lg hover:bg-[#F26B2B]/5 transition-colors">Download</a>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#4B5563] mb-4">No prelim has been received for this order yet.</p>
        )}
        <Link href={`/client/orders/${orderId}/prelim`} className="text-sm font-medium text-[#F26B2B] hover:text-[#E05A1A]">
          View full prelim details →
        </Link>
      </div>
    </div>
  );
}

/* ─── Inline Fees Tab ──────────────────────────────────────────────────────── */

interface FeeItem { description: string; amount: number; }
interface Invoice { id: string | number; label: string; items: FeeItem[]; total: number; }

function FeesTabContent({ orderId }: { orderId: number }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/client/orders/${orderId}/fees`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => { setInvoices(d.invoices ?? []); setGrandTotal(d.grandTotal ?? 0); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 animate-pulse"><div className="h-6 w-48 bg-gray-100 rounded mb-4" />{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded mt-3" />)}</div>;
  if (error) return <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 text-center"><p className="text-sm text-red-600">Could not load fee data</p></div>;
  if (invoices.length === 0) return <div className="bg-white rounded-xl border border-[#E5E7EB]"><EmptyStateFees /></div>;

  const allItems = invoices.flatMap((inv) => inv.items);
  const total = invoices.length > 1 ? grandTotal : invoices[0].total;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 bg-[#FEF3C7] rounded-xl border border-[#FCD34D]">
        <svg className="h-5 w-5 text-[#D97706] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
        <div>
          <p className="font-medium text-[#92400E] text-sm">Fee Estimate Notice</p>
          <p className="text-sm text-[#92400E]/80 mt-0.5">These fees are estimates and may change based on final transaction details.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E5E7EB]">
              <th className="text-left px-6 py-4 text-sm font-medium text-[#4B5563]">Description</th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[#4B5563]">Amount</th>
            </tr>
          </thead>
          <tbody>
            {allItems.map((fee, i) => (
              <tr key={i} className={i % 2 === 1 ? 'bg-[#FAFAFA]' : ''}>
                <td className="px-6 py-4 text-sm text-[#1B2A4A]">{fee.description}</td>
                <td className="px-6 py-4 text-sm text-[#1B2A4A] text-right font-mono tabular-nums">{fmt(fee.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-6 py-4 bg-[#1B2A4A]">
          <span className="font-semibold text-white">Total Estimated Fees</span>
          <span className="font-bold text-white text-lg font-mono tabular-nums">{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyStateFees() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="mb-4 p-4 rounded-full bg-[#F3F4F6]">
        <svg className="h-8 w-8 text-[#4B5563]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="text-sm text-[#4B5563]">No fee estimate available yet</p>
    </div>
  );
}

/* ─── Inline Notes Tab ─────────────────────────────────────────────────────── */

interface Note { id: number; content: string; createdAt: string; author: string; }

function NotesTabContent({ orderId }: { orderId: number }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/client/orders/${orderId}/notes`).then((r) => r.ok ? r.json() : { notes: [] })
      .then((d) => setNotes(d.notes ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, [orderId]);

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/client/orders/${orderId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: noteText.trim() }) });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (body?.note) setNotes((prev) => [body.note, ...prev]);
      setNoteText('');
    } catch { /* noop */ } finally { setSaving(false); }
  }

  if (loading) return <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 animate-pulse"><div className="h-20 bg-gray-100 rounded mb-4" /><div className="h-4 w-48 bg-gray-100 rounded" /></div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-6">
        <h3 className="font-semibold text-[#1B2A4A] mb-4">Add a Note</h3>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note about this order…"
          rows={3}
          className="w-full h-24 px-4 py-3 border border-[#E5E7EB] rounded-lg text-sm text-[#1B2A4A] placeholder:text-[#9CA3AF] resize-none focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/20 focus:border-[#F26B2B]"
        />
        <button
          onClick={handleAddNote}
          disabled={saving || !noteText.trim()}
          className="mt-3 px-5 py-2.5 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Add Note'}
        </button>
      </div>

      {notes.length > 0 ? (
        <div className="space-y-4">
          {notes.map((n) => (
            <div key={n.id} className="bg-white rounded-xl border border-[#E5E7EB] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-[#1B2A4A]">{n.author}</span>
                <span className="text-sm text-[#6B7280]">{fmtDate(n.createdAt)}</span>
              </div>
              <p className="text-sm text-[#4B5563] leading-relaxed whitespace-pre-wrap">{n.content}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-8 text-center">
          <p className="text-[#4B5563]">No notes have been added to this file.</p>
        </div>
      )}
    </div>
  );
}

/* ─── Skeleton ─────────────────────────────────────────────────────────────── */

function DetailSkeleton() {
  return (
    <div className="max-w-5xl mx-auto animate-pulse">
      <div className="h-4 w-28 bg-gray-100 rounded mb-6" />
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6">
        <div className="h-4 w-36 bg-gray-100 rounded mb-3" />
        <div className="h-7 w-72 bg-gray-100 rounded mb-4" />
        <div className="h-4 w-48 bg-gray-100 rounded" />
      </div>
      <div className="flex gap-6 mb-6 border-b border-[#E5E7EB] pb-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-4 w-16 bg-gray-100 rounded" />)}
      </div>
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-8">
        <div className="space-y-6">{SKELETON_LINE_WIDTHS.map((width) => <div key={width} className="h-4 bg-gray-100 rounded" style={{ width }} />)}</div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}
