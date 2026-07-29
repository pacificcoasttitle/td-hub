'use client';

import { useState, useEffect } from 'react';
import { ModalShell } from './modal-shell';
import { ActivityFeed } from '@/components/shared/activity-feed';
import { NotesTab } from './notes-tab';
import { createdByVariant, formatCreatedBy } from '@/lib/domain/orders/created-by-display';
import { formatOrderDate, formatOrderDateTime } from '@/lib/domain/orders/date-format';
import { formatCounty, formatOrderMoney } from '@/lib/domain/orders/order-format';
import { statusLabel } from '@/lib/domain/orders/status-format';

interface Assignment {
  id?: string | number | null;
  name: string | null;
  email?: string | null;
}

interface OrderDetail {
  id: number; fileNumber: string; operationalStatus: string;
  propertyStreet: string | null; propertyCity: string | null; propertyState: string | null; propertyZip: string | null;
  propertyCounty: string | null; propertyApn: string | null; propertyLegalDescription: string | null;
  propertyType: string | null;
  sellerFirstName: string | null; sellerLastName: string | null;
  buyerFirstName: string | null; buyerLastName: string | null;
  transactionType: string | null; productType: string | null; salesPrice: string | null; loanAmount: string | null;
  openedAt: string | null; closedAt: string | null;
  lenderName: string | null; escrowCompanyName: string | null;
  /** Staff-only; always null on the client legacy path. */
  source: string | null;
  /** Staff-only; always null on the client legacy path. */
  assignments: {
    salesRep: Assignment | null;
    titleOfficer: Assignment | null;
    createdBy: Assignment | null;
  } | null;
  parties: OrderParty[];
}

const SOURCE_LABELS: Record<string, string> = {
  manual_entry: 'TD Hub',
  softpro_sync: 'SoftPro',
};

function formatSource(source: string | null | undefined): string {
  if (!source) return '—';
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface OrderParty {
  role: string;
  isPrimary: boolean;
  externalName: string | null;
  externalCompany: string | null;
  externalEmail: string | null;
  externalPhone: string | null;
}

interface AdminDetailResponse {
  order?: {
    id: number; fileNumber: string; status: string;
    source?: string | null;
    transactionType: string | null; productType: string | null; salesPrice: string | null; loanAmount?: string | null;
    openedAt?: string | null; closedAt?: string | null;
  };
  property?: {
    address: string | null; city: string | null; state: string | null; zip: string | null;
    county: string | null; apn: string | null; legalDescription: string | null;
    propertyType?: string | null;
  };
  parties?: {
    items?: OrderParty[];
    buyer?: { firstName: string | null; lastName: string | null } | null;
    seller?: { firstName: string | null; lastName: string | null } | null;
    lender?: { name: string | null } | null;
    escrowOfficer?: { name: string | null } | null;
  };
  assignments?: {
    salesRep: Assignment | null;
    titleOfficer: Assignment | null;
    createdBy: Assignment | null;
  };
  milestones?: Milestone[];
}

interface LegacyDetailResponse {
  id: number; fileNumber: string; operationalStatus: string;
  transactionType: string | null; productType?: string | null; salesPrice?: string | null; loanAmount?: string | null;
  openedAt?: string | null; closedAt?: string | null;
  property?: {
    address: string | null; city: string | null; state: string | null; zip?: string | null;
    county?: string | null; apn?: string | null; legalDescription?: string | null;
    propertyType?: string | null;
  } | null;
  /** Client detail returns order_parties (client-redacted) on the legacy shape. */
  parties?: OrderParty[];
}

function isLegacyDetailResponse(data: AdminDetailResponse | LegacyDetailResponse): data is LegacyDetailResponse {
  return 'id' in data;
}

interface Doc {
  id: number; filename: string; originalFilename?: string | null;
  category: string | null; sizeBytes?: number | null; createdAt: string;
  isSyncedToSoftpro?: boolean | null;
  softproSyncedAt?: string | null;
  softproSyncError?: string | null;
  softproDocumentId?: string | null;
  softproAttachAttemptCount?: number | null;
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
  const visibleTabs = isClient ? TABS.filter((t) => t !== 'Milestones') : TABS;

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!open) { setTab('Overview'); return; }
      setLoading(true);
      Promise.all([
        fetch(detailUrl).then((r) => r.ok ? r.json() : null),
        fetch(`${base}/documents`).then((r) => r.ok ? r.json() : { documents: [] }),
      ]).then(([o, d]) => {
        setOrder(normalizeOrderDetail(o));
        setDocs(d?.documents ?? []);
        setMilestones(isClient ? [] : normalizeMilestones(o));
        setMilestonesError(null);
        setMilestonesLoading(false);
      })
        .catch(() => {}).finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timeout);
  }, [open, base, detailUrl, isClient]);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
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
    }, 0);
    return () => clearTimeout(timeout);
  }, [open, base]);

  const seller = order ? [order.sellerFirstName, order.sellerLastName].filter(Boolean).join(' ') : '';
  const buyer = order ? [order.buyerFirstName, order.buyerLastName].filter(Boolean).join(' ') : '';

  return (
    <ModalShell open={open} onClose={onClose} title={`Order ${fileNumber}`} subtitle={address} size="xl" accentColor={accentColor}>
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
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <F l="Status" v={statusLabel(order.operationalStatus)} />
                  <F l="Transaction" v={order.transactionType ?? '—'} />
                  <F l="Product" v={order.productType ?? '—'} />
                  <F l="Opened" v={formatOrderDate(order.openedAt)} />
                  <F l="Closed" v={formatOrderDate(order.closedAt)} />
                  <F l="Sales Price" v={displayMoney(order.salesPrice)} />
                  <F l="Loan Amount" v={displayMoney(order.loanAmount)} />
                  <F l="Seller" v={seller || '—'} />
                  <F l="Buyer" v={buyer || '—'} />
                  {/* Staff-only: client detail omits source; UI gates on !isClient. */}
                  {!isClient && <F l="Source" v={formatSource(order.source)} />}
                </div>
                {/* Staff-only: client path never receives assignments (API + applyVisibility). */}
                {!isClient && order.assignments && (
                  <AssignmentsBlock assignments={order.assignments} />
                )}
              </div>
            )}
            {tab === 'Property' && (
              <div className="grid grid-cols-2 gap-3">
                <F l="Address" v={order.propertyStreet ?? '—'} />
                <F l="City" v={order.propertyCity ?? '—'} />
                <F l="State" v={order.propertyState ?? '—'} />
                <F l="ZIP" v={order.propertyZip ?? '—'} />
                <F l="County" v={formatCounty(order.propertyCounty)} />
                <F l="Property Type" v={order.propertyType ?? '—'} />
                <F l="APN" v={order.propertyApn ?? '—'} />
                <div className="col-span-2">
                  <LegalDescriptionField value={order.propertyLegalDescription} />
                </div>
              </div>
            )}
            {tab === 'Parties' && (
              <PartiesTab parties={order.parties} />
            )}
            {tab === 'Documents' && (
              docs.length > 0 ? (
                <DocGroups
                  docs={docs}
                  isClient={isClient}
                  onRefreshDocs={() => {
                    fetch(`${base}/documents`)
                      .then((r) => r.ok ? r.json() : { documents: [] })
                      .then((d) => setDocs(d?.documents ?? []))
                      .catch(() => {});
                  }}
                />
              ) : (
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
          </div>
        </>
      )}
    </ModalShell>
  );
}

function normalizeOrderDetail(data: AdminDetailResponse | LegacyDetailResponse | null): OrderDetail | null {
  if (!data) return null;
  if (isLegacyDetailResponse(data)) {
    const parties = data.parties ?? [];
    const buyer = parties.find((p) => (p.role === 'buyer' || p.role === 'borrower') && p.isPrimary)
      ?? parties.find((p) => p.role === 'buyer' || p.role === 'borrower');
    const seller = parties.find((p) => p.role === 'seller' && p.isPrimary)
      ?? parties.find((p) => p.role === 'seller');
    const lender = parties.find((p) => p.role === 'lender' && p.isPrimary)
      ?? parties.find((p) => p.role === 'lender');
    const escrow = parties.find((p) => p.role === 'escrow_company' && p.isPrimary)
      ?? parties.find((p) => p.role === 'escrow_company');

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
      propertyType: data.property?.propertyType ?? null,
      sellerFirstName: seller?.externalName?.split(/\s+/)[0] ?? null,
      sellerLastName: seller?.externalName?.split(/\s+/).slice(1).join(' ') || null,
      buyerFirstName: buyer?.externalName?.split(/\s+/)[0] ?? null,
      buyerLastName: buyer?.externalName?.split(/\s+/).slice(1).join(' ') || null,
      transactionType: data.transactionType,
      productType: data.productType ?? null,
      salesPrice: data.salesPrice ?? null,
      loanAmount: data.loanAmount ?? null,
      openedAt: data.openedAt ?? null,
      closedAt: data.closedAt ?? null,
      lenderName: lender?.externalCompany ?? lender?.externalName ?? null,
      escrowCompanyName: escrow?.externalCompany ?? escrow?.externalName ?? null,
      source: null,
      assignments: null,
      parties,
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
    propertyType: data.property?.propertyType ?? null,
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
    source: data.order.source ?? null,
    assignments: data.assignments ?? null,
    parties: data.parties?.items ?? [],
  };
}

function normalizeMilestones(data: AdminDetailResponse | LegacyDetailResponse | null): Milestone[] {
  if (!data || isLegacyDetailResponse(data)) return [];
  return data.milestones ?? [];
}

function F({ l, v }: { l: string; v: string }) {
  return <div className="px-3 py-2.5 bg-gray-50 rounded-lg"><p className="text-[10px] uppercase tracking-wider text-[#6B7280]">{l}</p><p className="text-sm font-medium text-[#1A1A2E] mt-0.5 truncate">{v}</p></div>;
}

function LegalDescriptionField({ value }: { value: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const legal = value?.trim() || '';
  const isLong = legal.length > 150;

  return (
    <div className="px-3 py-2.5 bg-gray-50 rounded-lg">
      <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">Legal Description</p>
      <p className={`text-sm font-medium text-[#1A1A2E] mt-0.5 whitespace-pre-wrap ${!expanded && isLong ? 'line-clamp-3' : ''}`}>
        {legal || '—'}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-xs text-[#1B2A4A] font-medium mt-1 hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function AssignmentsBlock({ assignments }: {
  assignments: NonNullable<OrderDetail['assignments']>;
}) {
  const createdByName = assignments.createdBy?.name;
  const createdByDisplay = formatCreatedBy(createdByName);
  const createdByClass = createdByVariant(createdByName) === 'system'
    ? 'text-[#9CA3AF] italic'
    : '';

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-2">Assignments</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <F l="Sales Rep" v={assignments.salesRep?.name?.trim() || '—'} />
        <F l="Title Officer" v={assignments.titleOfficer?.name?.trim() || '—'} />
        <div className="px-3 py-2.5 bg-gray-50 rounded-lg">
          <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">Created By</p>
          <p className={`text-sm font-medium mt-0.5 truncate ${createdByClass || 'text-[#1A1A2E]'}`}>
            {createdByDisplay}
          </p>
        </div>
      </div>
    </div>
  );
}

function PartiesTab({ parties }: { parties: OrderParty[] }) {
  if (parties.length === 0) {
    return (
      <div className="p-8 text-center bg-gray-50 rounded-lg">
        <p className="text-sm font-medium text-[#1A1A2E]">No parties found</p>
        <p className="text-xs text-[#6B7280] mt-1">SoftPro confirmed this order has no external parties yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {parties.map((party, index) => (
        <PartyField key={`${party.role}-${index}`} party={party} />
      ))}
    </div>
  );
}

function PartyField({ party }: { party: OrderParty }) {
  const company = party.externalCompany?.trim() || null;
  const person = party.externalName?.trim() || null;
  const primaryLine = company ?? person ?? '—';
  const secondaryLine = company && person ? person : null;

  return (
    <div className="px-3 py-2.5 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">{partyLabel(party)}</p>
        {party.isPrimary && <span className="text-[10px] font-medium text-[#6B7280] normal-case">(Primary)</span>}
      </div>
      <p className="text-sm font-medium text-[#1A1A2E] mt-0.5 truncate">{primaryLine}</p>
      {secondaryLine && <p className="text-xs text-[#4B5563] mt-0.5 truncate">{secondaryLine}</p>}
      {(party.externalEmail || party.externalPhone) && (
        <div className="text-xs text-[#6B7280] mt-1 space-y-px">
          {party.externalEmail && <p className="truncate">{party.externalEmail}</p>}
          {party.externalPhone && <p>{party.externalPhone}</p>}
        </div>
      )}
    </div>
  );
}

function partyLabel(party: OrderParty): string {
  switch (party.role) {
    case 'buyer':
    case 'borrower':
      return 'Buyer / Borrower';
    case 'seller':
      return 'Seller';
    case 'lender':
      return 'Lender';
    case 'lender_contact':
      return 'Lender Contact';
    case 'listing_agent':
      return 'Listing Agent';
    case 'escrow_company':
      return 'Escrow Company';
    case 'other':
      return party.isPrimary ? 'Title Company' : 'Underwriter';
    default:
      return party.role.replace(/_/g, ' ');
  }
}

function displayMoney(value: number | string | null | undefined): string {
  if (typeof value === 'string' && (value.startsWith('$') || value === '—')) return value;
  return formatOrderMoney(value);
}

function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n)
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : '$0.00';
}

function dateLabel(value: string | null | undefined): string {
  return formatOrderDate(value);
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
        <p className="text-sm font-medium text-[#1A1A2E]">No milestones yet</p>
        <p className="text-xs text-[#6B7280] mt-1">Milestones appear as order progress is recorded.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-[#6B7280] mb-4">Order progress</p>
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
  prelim:           ['Prelim',           'bg-sky-100 text-sky-700'],
  cpl:              ['CPL',              'bg-purple-100 text-purple-700'],
  proposed_insured: ['Proposed Insured', 'bg-teal-100 text-teal-700'],
  legal_vesting:    ['Vesting',          'bg-blue-100 text-blue-700'],
  tax:              ['Tax',              'bg-green-100 text-green-700'],
  grant_deed:       ['Grant Deed',       'bg-amber-100 text-amber-700'],
};

const DOC_GROUPS: { label: string; cats: string[] }[] = [
  { label: 'Prelim', cats: ['prelim'] },
  { label: 'Vesting', cats: ['legal_vesting'] },
  { label: 'Tax', cats: ['tax'] },
  { label: 'Grant Deed', cats: ['grant_deed'] },
  { label: 'CPL', cats: ['cpl'] },
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
    const full = formatOrderDateTime(d);
    if (diff < 60_000) return { display: 'just now', full };
    if (diff < 3_600_000) return { display: `${Math.floor(diff / 60_000)}m ago`, full };
    if (diff < 86_400_000) return { display: `${Math.floor(diff / 3_600_000)}h ago`, full };
    return { display: formatOrderDate(d), full };
  } catch { return { display: '—', full: '—' }; }
}

function SoftProSyncBadge({
  doc,
  isClient,
  onRetry,
  retrying,
}: {
  doc: Doc;
  isClient?: boolean;
  onRetry: (id: number) => void;
  retrying: boolean;
}) {
  if (isClient) return null;
  if (doc.isSyncedToSoftpro) {
    return (
      <span
        className="shrink-0 text-[11px] font-medium text-green-700"
        title={doc.softproDocumentId ? `SoftPro id ${doc.softproDocumentId}` : 'Synced to SoftPro'}
      >
        In SoftPro
      </span>
    );
  }
  return (
    <div className="shrink-0 flex flex-col items-end gap-0.5">
      <span
        className="text-[11px] font-medium text-amber-700"
        title={doc.softproSyncError ?? 'Not synced to SoftPro'}
      >
        Not in SoftPro
      </span>
      <button
        type="button"
        disabled={retrying}
        onClick={() => onRetry(doc.id)}
        className="text-[11px] font-semibold text-[#1B2A4A] hover:text-[#C5A55A] disabled:opacity-50"
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

function DocGroups({
  docs,
  isClient,
  onRefreshDocs,
}: {
  docs: Doc[];
  isClient?: boolean;
  onRefreshDocs?: () => void;
}) {
  const dlBase = isClient ? '/api/client' : '/api';
  const [retryingId, setRetryingId] = useState<number | null>(null);

  async function handleRetry(documentId: number) {
    setRetryingId(documentId);
    try {
      const res = await fetch(`/api/documents/${documentId}/attach`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Retry failed (${res.status})`);
      }
      onRefreshDocs?.();
    } catch {
      // Failure is recorded on the documents row; refresh to surface softpro_sync_error.
      onRefreshDocs?.();
    } finally {
      setRetryingId(null);
    }
  }

  const grouped = DOC_GROUPS.map(({ label, cats }) => ({
    label,
    items: docs.filter((d) => cats.includes(d.category ?? '')),
  }));
  const otherCats = new Set(DOC_GROUPS.flatMap((g) => g.cats));
  const other = docs.filter((d) => !otherCats.has(d.category ?? ''));
  if (other.length) grouped.push({ label: 'Other', items: other });

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
                  <SoftProSyncBadge
                    doc={d}
                    isClient={isClient}
                    onRetry={handleRetry}
                    retrying={retryingId === d.id}
                  />
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
