'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import OrderDocuments from '@/components/admin/order-documents';
import OrderFees from '@/components/admin/order-fees';
import OrderCpl from '@/components/admin/order-cpl';
import OrderTitlePoint from '@/components/admin/order-titlepoint';
import { OrderOverviewTab } from '@/components/admin/order-tabs/order-overview-tab';
import { OrderPropertyTab } from '@/components/admin/order-tabs/order-property-tab';
import { OrderHistoryTab } from '@/components/admin/order-tabs/order-history-tab';
import { DeliverPrelimModal } from '@/components/shared/action-modals';
import { formatOrderAddress } from '@/lib/domain/orders/order-format';
import { statusBadge } from '@/lib/domain/orders/status-format';

interface OrderProperty {
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  fullAddress: string | null;
  apn: string | null;
  legalDescription: string | null;
  propertyType: string | null;
  zip: string | null;
}

interface StatusHistoryEntry {
  id: number;
  status: string;
  source: string;
  notes: string | null;
  changedAt: string;
}

interface OrderDetail {
  id: number;
  fileNumber: string;
  operationalStatus: string;
  softproStatus: string | null;
  transactionType: string | null;
  productType: string | null;
  orderType: string | null;
  source: string;
  openedAt: string;
  completedAt: string | null;
  closedAt: string | null;
  salesPrice: string | null;
  loanAmount: string | null;
  isImported: boolean;
  softproLastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  property: OrderProperty | null;
  parties: unknown[];
  statusHistory: StatusHistoryEntry[];
  documents?: {
    prelim?: { exists: boolean };
  };
}

const TABS = ['Overview', 'Property', 'Documents', 'Fees', 'Vendor Actions', 'History'] as const;
type Tab = (typeof TABS)[number];

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ match: boolean; changes: { field: string; old: string; new: string }[] } | null>(null);
  const [deliverPrelimOpen, setDeliverPrelimOpen] = useState(false);

  const fetchOrder = useCallback(
    (signal?: AbortSignal) =>
      fetch(`/api/orders/${params.id}`, { signal })
        .then((res) => {
          if (res.status === 404) throw new Error('Order not found');
          if (!res.ok) throw new Error(`Failed to load order (${res.status})`);
          return res.json() as Promise<OrderDetail>;
        })
        .then(setOrder),
    [params.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
    });
    fetchOrder(controller.signal)
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [fetchOrder]);

  async function handleResync() {
    setSyncing(true); setSyncError(null); setSyncSuccess(false);
    try {
      const res = await fetch(`/api/orders/${params.id}/resync`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Resync failed (${res.status})`);
      }
      await fetchOrder();
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 4000);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Resync failed');
      setTimeout(() => setSyncError(null), 5000);
    } finally {
      setSyncing(false);
    }
  }

  async function handleVerifySync() {
    setVerifying(true); setVerifyResult(null);
    try {
      const res = await fetch(`/api/orders/${params.id}/verify-sync`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Verification failed');
      setVerifyResult({ match: body.match ?? true, changes: body.changes ?? [] });
      if (!body.match) await fetchOrder();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Verification failed');
      setTimeout(() => setSyncError(null), 5000);
    } finally { setVerifying(false); }
  }

  if (loading) return <DetailSkeleton />;

  if (error) {
    return (
      <div className="p-6">
        <BackLink />
        <div className="mt-8 bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-[#6B7280] mt-1">The order may have been removed or you may not have access.</p>
          <button onClick={() => router.push('/orders')}
            className="mt-4 px-4 py-2 text-sm bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors">
            Back to Orders
          </button>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const deliverStatus = (order.softproStatus ?? order.operationalStatus ?? '').toLowerCase().trim();
  const canDeliverPrelim = !!order.documents?.prelim?.exists && !['canceled', 'cancelled', 'duplicate'].includes(deliverStatus);
  const orderAddress = formatOrderAddress(order.property);

  return (
    <div className="p-6">
      <BackLink />
      <div className="flex items-start justify-between mt-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-[#1A1A2E]">{order.fileNumber}</h1>
            <StatusBadge status={order.operationalStatus} />
          </div>
          {orderAddress !== '—' && <p className="text-[#6B7280] mt-1">{orderAddress}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {order.softproLastSyncedAt && <p className="text-xs text-[#6B7280]">Last synced {formatDateTime(order.softproLastSyncedAt)}</p>}
          {canDeliverPrelim && (
            <button onClick={() => setDeliverPrelimOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] transition-colors">
              Deliver Prelim
            </button>
          )}
          <button onClick={handleVerifySync} disabled={verifying || syncing}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <svg className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {verifying ? 'Checking SoftPro…' : 'Verify Sync'}
          </button>
          <button onClick={handleResync} disabled={syncing || verifying}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-lg hover:bg-[#1B2A4A]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            <svg className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? 'Syncing…' : 'Resync from SoftPro'}
          </button>
        </div>
      </div>
      {syncError && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between">
          <span>{syncError}</span>
          <button onClick={() => setSyncError(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}
      {syncSuccess && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">Order resynced successfully.</div>
      )}
      {verifyResult && (
        <div className={`mb-4 rounded-lg border shadow-sm overflow-hidden ${verifyResult.match ? 'border-green-200' : 'border-amber-200'}`}>
          <div className={`px-4 py-2.5 flex items-center justify-between ${verifyResult.match ? 'bg-green-50' : 'bg-amber-50'}`}>
            <div className="flex items-center gap-2">
              {verifyResult.match ? (
                <svg className="h-4 w-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="h-4 w-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              <span className={`text-sm font-medium ${verifyResult.match ? 'text-green-700' : 'text-amber-700'}`}>
                {verifyResult.match ? 'Order data matches SoftPro' : `${verifyResult.changes.length} change${verifyResult.changes.length !== 1 ? 's' : ''} applied`}
              </span>
            </div>
            <button onClick={() => setVerifyResult(null)} className="text-gray-400 hover:text-gray-600">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          {!verifyResult.match && verifyResult.changes.length > 0 && (
            <div className="divide-y divide-gray-100 bg-white">
              {verifyResult.changes.map((c, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="font-medium text-[#1A1A2E] w-40 shrink-0">{c.field}</span>
                  <span className="text-red-600 line-through">{c.old || '(empty)'}</span>
                  <svg className="h-3 w-3 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  <span className="text-green-700 font-medium">{c.new || '(empty)'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === tab ? 'text-[#1B2A4A]' : 'text-[#6B7280] hover:text-[#1A1A2E]'}`}>
              {tab}
              {activeTab === tab && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C5A55A] rounded-full" />}
            </button>
          ))}
        </nav>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        {activeTab === 'Overview' && <OrderOverviewTab order={order} />}
        {activeTab === 'Property' && <OrderPropertyTab property={order.property} orderId={order.id} onPropertyUpdated={() => fetchOrder()} />}
        {activeTab === 'History' && <OrderHistoryTab history={order.statusHistory} />}
        {activeTab === 'Documents' && <OrderDocuments orderId={order.id} />}
        {activeTab === 'Fees' && <OrderFees orderId={order.id} />}
        {activeTab === 'Vendor Actions' && (
          <div className="divide-y divide-gray-200">
            <div className="p-6"><OrderCpl orderId={order.id} fileNumber={order.fileNumber} /></div>
            <div className="p-6"><OrderTitlePoint orderId={order.id} fileNumber={order.fileNumber} /></div>
          </div>
        )}
      </div>
      <DeliverPrelimModal
        open={deliverPrelimOpen}
        onClose={() => setDeliverPrelimOpen(false)}
        orderId={order.id}
        fileNumber={order.fileNumber}
        address={orderAddress === '—' ? '' : orderAddress}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/orders" className="inline-flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#1B2A4A] transition-colors">
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back to Orders
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const badge = statusBadge(status);
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${badge.color}`}>{badge.label}</span>;
}

function DetailSkeleton() {
  return (
    <div className="p-6 animate-pulse">
      <div className="h-4 w-28 bg-gray-200 rounded" />
      <div className="mt-4 flex items-center gap-3">
        <div className="h-7 w-40 bg-gray-200 rounded" />
        <div className="h-5 w-16 bg-gray-200 rounded-full" />
      </div>
      <div className="h-4 w-64 bg-gray-200 rounded mt-2" />
      <div className="mt-8 flex gap-6 border-b border-gray-200 pb-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-4 w-20 bg-gray-200 rounded" />)}
      </div>
      <div className="mt-6 bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="grid grid-cols-2 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 w-28 bg-gray-200 rounded" />
              <div className="h-4 w-36 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return '—'; }
}
