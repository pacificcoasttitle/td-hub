'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ModalShell } from './modal-shell';
import { ActivityFeed } from '@/components/shared/activity-feed';
import { NotesTab } from './notes-tab';

interface OrderDetail {
  id: number; fileNumber: string; operationalStatus: string;
  propertyStreet: string | null; propertyCity: string | null; propertyState: string | null; propertyZip: string | null;
  propertyCounty: string | null; propertyApn: string | null; propertyLegalDescription: string | null;
  sellerFirstName: string | null; sellerLastName: string | null;
  buyerFirstName: string | null; buyerLastName: string | null;
  transactionType: string | null; productType: string | null; salesPrice: string | null; loanAmount: string | null;
  openedAt: string | null; closedAt: string | null;
  lenderName: string | null; escrowCompanyName: string | null;
}

interface AdminDetailResponse {
  order?: {
    id: number; fileNumber: string; status: string;
    transactionType: string | null; productType: string | null; salesPrice: string | null; loanAmount?: string | null;
    openedAt?: string | null; closedAt?: string | null;
  };
  property?: {
    address: string | null; city: string | null; state: string | null; zip: string | null;
    county: string | null; apn: string | null; legalDescription: string | null;
  };
  parties?: {
    buyer?: { firstName: string | null; lastName: string | null } | null;
    seller?: { firstName: string | null; lastName: string | null } | null;
    lender?: { name: string | null } | null;
    escrowOfficer?: { name: string | null } | null;
  };
}

interface LegacyDetailResponse {
  id: number; fileNumber: string; operationalStatus: string;
  transactionType: string | null; productType?: string | null; salesPrice?: string | null; loanAmount?: string | null;
  openedAt?: string | null; closedAt?: string | null;
  property?: {
    address: string | null; city: string | null; state: string | null; zip?: string | null;
    county?: string | null; apn?: string | null; legalDescription?: string | null;
  } | null;
}

interface Doc {
  id: number; filename: string; originalFilename?: string | null;
  category: string | null; sizeBytes?: number | null; createdAt: string;
}

interface FeeLineItem {
  description: string | null;
  amount: number | string | null;
}

interface FeeInvoice {
  invoiceNumber: string | null;
  invoiceDate?: string | null;
  date?: string | null;
  fees: FeeLineItem[];
  total: number | string | null;
}

interface FeesData {
  invoices: FeeInvoice[];
  grandTotal: number;
}

interface Milestone {
  id: number;
  status: string;
  label: string;
  notes: string | null;
  occurredAt: string;
}

const TABS = ['Overview', 'Property', 'Parties', 'Documents', 'Activity', 'Notes', 'Fees', 'Milestones'] as const;
type Tab = (typeof TABS)[number];

export function DetailModal({ open, onClose, orderId, fileNumber, address, isClient, accentColor }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  isClient?: boolean; accentColor?: string;
}) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [fees, setFees] = useState<FeesData | null>(null);
  const [feesLoading, setFeesLoading] = useState(false);
  const [feesError, setFeesError] = useState<string | null>(null);
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  const [milestonesError, setMilestonesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const base = isClient ? `/api/client/orders/${orderId}` : `/api/orders/${orderId}`;
  const detailUrl = isClient ? base : `/api/admin/orders/${orderId}/detail`;
  const detailHref = isClient ? `/client/orders/${orderId}` : `/orders/${orderId}`;
  const visibleTabs = isClient ? TABS.filter((t) => t !== 'Milestones') : TABS;

  useEffect(() => {
    if (!open) { setTab('Overview'); return; }
    setLoading(true);
    Promise.all([
      fetch(detailUrl).then((r) => r.ok ? r.json() : null),
      fetch(`${base}/documents`).then((r) => r.ok ? r.json() : { documents: [] }),
    ]).then(([o, d]) => { setOrder(normalizeOrderDetail(o)); setDocs(d?.documents ?? []); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [open, base, detailUrl]);

  useEffect(() => {
    if (!open) return;
    setFees(null);
    setFeesError(null);
    setFeesLoading(true);
    setExpandedInvoices(new Set());

    fetch(`${base}/fees`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || body?.success === false) {
          throw new Error(body?.error ?? `Failed to load fees (${r.status})`);
        }
        return body?.data as FeesData | undefined;
      })
      .then((data) => setFees(data ?? { invoices: [], grandTotal: 0 }))
      .catch((err: unknown) => setFeesError(err instanceof Error ? err.message : 'Failed to load fees'))
      .finally(() => setFeesLoading(false));
  }, [open, base]);

  useEffect(() => {
    if (!open || isClient) return;
    setMilestones([]);
    setMilestonesError(null);
    setMilestonesLoading(true);

    fetch(`/api/orders/${orderId}/milestones`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `Failed to load milestones (${r.status})`);
        return body?.milestones as Milestone[] | undefined;
      })
      .then((items) => setMilestones(items ?? []))
      .catch((err: unknown) => setMilestonesError(err instanceof Error ? err.message : 'Failed to load milestones'))
      .finally(() => setMilestonesLoading(false));
  }, [open, isClient, orderId]);

  const seller = order ? [order.sellerFirstName, order.sellerLastName].filter(Boolean).join(' ') : '';
  const buyer = order ? [order.buyerFirstName, order.buyerLastName].filter(Boolean).join(' ') : '';

  return (
    <ModalShell open={open} onClose={onClose} title={`Order ${fileNumber}`} subtitle={address} wide accentColor={accentColor}>
      {loading ? (
        <div className="p-10 text-center"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#F26B2B] rounded-full animate-spin mx-auto" /></div>
      ) : !order ? (
        <div className="p-10 text-center text-sm text-[#6B7280]">Order not found.</div>
      ) : (
        <>
          <div className="flex border-b border-gray-100 px-5">
            {visibleTabs.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${tab === t ? 'border-[#F26B2B] text-[#1A1A2E]' : 'border-transparent text-[#6B7280] hover:text-[#1A1A2E]'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="p-5">
            {tab === 'Overview' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <F l="Status" v={order.operationalStatus ?? '—'} />
                <F l="Transaction" v={order.transactionType ?? '—'} />
                <F l="Product" v={order.productType ?? '—'} />
                <F l="Opened" v={order.openedAt ? new Date(order.openedAt).toLocaleDateString() : '—'} />
                <F l="Closed" v={order.closedAt ? new Date(order.closedAt).toLocaleDateString() : '—'} />
                <F l="Sales Price" v={order.salesPrice ? `$${Number(order.salesPrice).toLocaleString()}` : '—'} />
                <F l="Loan Amount" v={order.loanAmount ? `$${Number(order.loanAmount).toLocaleString()}` : '—'} />
                <F l="Seller" v={seller || '—'} />
                <F l="Buyer" v={buyer || '—'} />
              </div>
            )}
            {tab === 'Property' && (
              <div className="grid grid-cols-2 gap-3">
                <F l="Address" v={order.propertyStreet ?? '—'} />
                <F l="City" v={order.propertyCity ?? '—'} />
                <F l="State" v={order.propertyState ?? '—'} />
                <F l="ZIP" v={order.propertyZip ?? '—'} />
                <F l="County" v={order.propertyCounty ?? '—'} />
                <F l="APN" v={order.propertyApn ?? '—'} />
                <div className="col-span-2"><F l="Legal Description" v={order.propertyLegalDescription ?? '—'} /></div>
              </div>
            )}
            {tab === 'Parties' && (
              <div className="grid grid-cols-2 gap-3">
                <F l="Seller" v={seller || '—'} />
                <F l="Buyer / Borrower" v={buyer || '—'} />
                <F l="Lender" v={order.lenderName ?? '—'} />
                <F l="Escrow Company" v={order.escrowCompanyName ?? '—'} />
              </div>
            )}
            {tab === 'Documents' && (
              docs.length > 0 ? <DocGroups docs={docs} isClient={isClient} /> : (
                <div className="text-center py-8">
                  <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  <p className="text-sm font-medium text-[#1A1A2E] mt-3">No documents generated yet</p>
                  <p className="text-xs text-[#6B7280] mt-1">Documents will appear here once generated.</p>
                </div>
              )
            )}
            {tab === 'Activity' && (
              <ActivityFeed fetchUrl={`${base}/activity`} accentColor={accentColor} />
            )}
            {tab === 'Notes' && (
              <NotesTab notesUrl={`${base}/notes`} accentColor={accentColor} />
            )}
            {tab === 'Fees' && (
              <FeesTab
                fees={fees}
                loading={feesLoading}
                error={feesError}
                expanded={expandedInvoices}
                onToggle={(invoiceKey) => setExpandedInvoices((prev) => {
                  const next = new Set(prev);
                  if (next.has(invoiceKey)) next.delete(invoiceKey);
                  else next.add(invoiceKey);
                  return next;
                })}
              />
            )}
            {tab === 'Milestones' && !isClient && (
              <MilestonesTab milestones={milestones} loading={milestonesLoading} error={milestonesError} />
            )}
            <div className="mt-6 pt-4 border-t border-gray-100">
              <Link href={detailHref} className="text-xs font-semibold text-[#F26B2B] hover:text-[#E05A1A]" onClick={onClose}>Open Full Page →</Link>
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function normalizeOrderDetail(data: AdminDetailResponse | LegacyDetailResponse | null): OrderDetail | null {
  if (!data) return null;
  if (!('order' in data)) {
    return {
      id: data.id,
      fileNumber: data.fileNumber,
      operationalStatus: data.operationalStatus,
      propertyStreet: data.property?.address ?? null,
      propertyCity: data.property?.city ?? null,
      propertyState: data.property?.state ?? null,
      propertyZip: data.property?.zip ?? null,
      propertyCounty: data.property?.county ?? null,
      propertyApn: data.property?.apn ?? null,
      propertyLegalDescription: data.property?.legalDescription ?? null,
      sellerFirstName: null,
      sellerLastName: null,
      buyerFirstName: null,
      buyerLastName: null,
      transactionType: data.transactionType,
      productType: data.productType ?? null,
      salesPrice: data.salesPrice ?? null,
      loanAmount: data.loanAmount ?? null,
      openedAt: data.openedAt ?? null,
      closedAt: data.closedAt ?? null,
      lenderName: null,
      escrowCompanyName: null,
    };
  }

  if (!data.order) return null;
  return {
    id: data.order.id,
    fileNumber: data.order.fileNumber,
    operationalStatus: data.order.status,
    propertyStreet: data.property?.address ?? null,
    propertyCity: data.property?.city ?? null,
    propertyState: data.property?.state ?? null,
    propertyZip: data.property?.zip ?? null,
    propertyCounty: data.property?.county ?? null,
    propertyApn: data.property?.apn ?? null,
    propertyLegalDescription: data.property?.legalDescription ?? null,
    sellerFirstName: data.parties?.seller?.firstName ?? null,
    sellerLastName: data.parties?.seller?.lastName ?? null,
    buyerFirstName: data.parties?.buyer?.firstName ?? null,
    buyerLastName: data.parties?.buyer?.lastName ?? null,
    transactionType: data.order.transactionType,
    productType: data.order.productType,
    salesPrice: data.order.salesPrice,
    loanAmount: data.order.loanAmount ?? null,
    openedAt: data.order.openedAt ?? null,
    closedAt: data.order.closedAt ?? null,
    lenderName: data.parties?.lender?.name ?? null,
    escrowCompanyName: data.parties?.escrowOfficer?.name ?? null,
  };
}

function F({ l, v }: { l: string; v: string }) {
  return <div className="px-3 py-2.5 bg-gray-50 rounded-lg"><p className="text-[10px] uppercase tracking-wider text-[#6B7280]">{l}</p><p className="text-sm font-medium text-[#1A1A2E] mt-0.5 truncate">{v}</p></div>;
}

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n)
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : '$0.00';
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function FeesTab({
  fees,
  loading,
  error,
  expanded,
  onToggle,
}: {
  fees: FeesData | null;
  loading: boolean;
  error: string | null;
  expanded: Set<string>;
  onToggle: (invoiceKey: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-[#6B7280]">Loading live fees from SoftPro…</p>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-11 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-center text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>;
  }

  const invoices = fees?.invoices ?? [];
  if (invoices.length === 0) {
    return (
      <div className="p-8 text-center bg-gray-50 rounded-lg">
        <p className="text-sm font-medium text-[#1A1A2E]">No fees found</p>
        <p className="text-xs text-[#6B7280] mt-1">SoftPro did not return invoice fees for this order.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-[#6B7280]">
          <tr>
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2 text-left font-medium">Invoice #</th>
            <th className="px-3 py-2 text-left font-medium">Date</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {invoices.map((invoice, i) => {
            const key = invoice.invoiceNumber ?? `invoice-${i}`;
            const isExpanded = expanded.has(key);
            const date = invoice.invoiceDate ?? invoice.date ?? null;
            return (
              <tr key={key} className="align-top">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    className="w-6 h-6 rounded-full text-[#6B7280] hover:bg-gray-100"
                    aria-label={isExpanded ? 'Collapse invoice fees' : 'Expand invoice fees'}
                  >
                    {isExpanded ? '−' : '+'}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-[#1A1A2E]">{invoice.invoiceNumber ?? '—'}</p>
                  {isExpanded && (
                    <div className="mt-2 space-y-1">
                      {invoice.fees.length > 0 ? invoice.fees.map((fee, feeIdx) => (
                        <div key={`${key}-${feeIdx}`} className="flex justify-between gap-4 text-xs text-[#6B7280]">
                          <span className="min-w-0 truncate">{fee.description ?? 'Fee'}</span>
                          <span className="shrink-0 tabular-nums">{money(fee.amount)}</span>
                        </div>
                      )) : (
                        <p className="text-xs text-[#6B7280]">No line items returned.</p>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-[#4B5563] whitespace-nowrap">{dateLabel(date)}</td>
                <td className="px-3 py-2 text-right font-semibold text-[#1A1A2E] tabular-nums">{money(invoice.total)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-gray-50 border-t border-gray-200">
          <tr>
            <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold text-[#1A1A2E]">Grand Total</td>
            <td className="px-3 py-2 text-right text-sm font-bold text-[#1A1A2E] tabular-nums">{money(fees?.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MilestonesTab({
  milestones,
  loading,
  error,
}: {
  milestones: Milestone[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-[#6B7280]">Milestones reported by SoftPro. New events appear as they occur.</p>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-center text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>;
  }

  if (milestones.length === 0) {
    return (
      <div className="p-8 text-center bg-gray-50 rounded-lg">
        <p className="text-sm font-medium text-[#1A1A2E]">No webhook milestones yet</p>
        <p className="text-xs text-[#6B7280] mt-1">Milestones reported by SoftPro. New events appear as they occur.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-[#6B7280] mb-4">Milestones reported by SoftPro. New events appear as they occur.</p>
      <div className="space-y-3">
        {milestones.map((m, i) => (
          <div key={m.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F26B2B] mt-1.5" />
              {i < milestones.length - 1 && <span className="w-px flex-1 bg-gray-200 mt-1" />}
            </div>
            <div className="pb-4 min-w-0">
              <p className="text-sm font-semibold text-[#1A1A2E]">{m.label}</p>
              <p className="text-xs text-[#6B7280] mt-0.5">{dateLabel(m.occurredAt)} · {m.status}</p>
              {m.notes && <p className="text-sm text-[#4B5563] mt-1 whitespace-pre-wrap">{m.notes}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Document Grouping ─────────────────────────────────────────────────────── */

const CAT_BADGE: Record<string, [string, string]> = {
  cpl:              ['CPL',              'bg-purple-100 text-purple-700'],
  proposed_insured: ['Proposed Insured', 'bg-teal-100 text-teal-700'],
  legal_vesting:    ['Legal Vesting',    'bg-blue-100 text-blue-700'],
  tax:              ['Tax',              'bg-green-100 text-green-700'],
  grant_deed:       ['Grant Deed',       'bg-amber-100 text-amber-700'],
};

const DOC_GROUPS: { label: string; cats: string[] }[] = [
  { label: 'Open Order Documents', cats: ['legal_vesting', 'tax', 'grant_deed'] },
  { label: 'CPLs', cats: ['cpl'] },
  { label: 'Proposed Insured', cats: ['proposed_insured'] },
];

function fmtSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTime(iso: string): { display: string; full: string } {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const full = d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    if (diff < 60_000) return { display: 'just now', full };
    if (diff < 3_600_000) return { display: `${Math.floor(diff / 60_000)}m ago`, full };
    if (diff < 86_400_000) return { display: `${Math.floor(diff / 3_600_000)}h ago`, full };
    return { display: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), full };
  } catch { return { display: iso, full: iso }; }
}

function DocGroups({ docs, isClient }: { docs: Doc[]; isClient?: boolean }) {
  const dlBase = isClient ? '/api/client' : '/api';
  const grouped = DOC_GROUPS.map(({ label, cats }) => ({
    label,
    items: docs.filter((d) => cats.includes(d.category ?? '')),
  }));
  const otherCats = new Set(DOC_GROUPS.flatMap((g) => g.cats));
  const other = docs.filter((d) => !otherCats.has(d.category ?? ''));
  if (other.length) grouped.push({ label: 'Other Documents', items: other });

  return (
    <div className="space-y-5">
      {grouped.filter((g) => g.items.length > 0).map(({ label, items }) => (
        <div key={label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-2">{label}</p>
          <div className="space-y-1.5">
            {items.map((d) => {
              const [badge, cls] = CAT_BADGE[d.category ?? ''] ?? [d.category ?? 'general', 'bg-gray-100 text-gray-600'];
              const name = d.originalFilename || d.filename;
              const size = fmtSize(d.sizeBytes);
              const time = fmtTime(d.createdAt);
              return (
                <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-lg group">
                  <span className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{badge}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#1A1A2E] truncate" title={name}>{name}</p>
                    <p className="text-xs text-[#6B7280]">
                      <span title={time.full}>{time.display}</span>
                      {size && <> · {size}</>}
                    </p>
                  </div>
                  <button
                    onClick={() => window.open(`${dlBase}/documents/${d.id}/download`, '_blank')}
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#F26B2B] hover:text-[#E05A1A] opacity-70 group-hover:opacity-100 transition-opacity"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
