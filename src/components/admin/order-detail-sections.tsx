'use client';

import { useState } from 'react';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface Party { firstName?: string; lastName?: string; name?: string; email?: string | null; phone?: string | null; company?: string | null; isOrganization?: boolean; id?: number }
interface Assignment { id: number; name: string; email?: string | null }
interface HistoryEntry { status: string; source: string; note?: string | null; createdAt: string }

export interface OrderDetail {
  order: {
    id: number; fileNumber: string; status: string; source: string | null;
    productType: string | null; transactionType: string | null;
    salesPrice: number | null; createdAt: string; updatedAt: string;
    emailStatus: string | null; dupOverride: boolean | null; marketingSource: string | null;
  };
  property: {
    address: string | null; city: string | null; state: string | null; zip: string | null;
    county: string | null; apn: string | null; legalDescription: string | null; propertyType: string | null;
  } | null;
  parties: {
    buyer: Party | null; seller: (Party & { isOrganization?: boolean }) | null;
    escrowOfficer: Party | null; lender: Party | null; listingAgent: Party | null;
    titleCompany: Party | null; underwriter: Party | null;
  };
  assignments: { salesRep: Assignment | null; titleOfficer: Assignment | null; createdBy: Assignment | null };
  documents: { count: number; categories: string[] };
  statusHistory: HistoryEntry[];
}

/* ── Status badge ──────────────────────────────────────────────────────────── */

const STATUS_CLS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800', in_process: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800', closed: 'bg-slate-100 text-slate-800',
  canceled: 'bg-red-100 text-red-800', duplicate: 'bg-gray-100 text-gray-600',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_CLS[status] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

/* ── Section header helper ─────────────────────────────────────────────────── */

function SH({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{children}</h4>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-gray-500">{children}</span>;
}
function Val({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium text-[#1A1A2E]">{children}</span>;
}
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><Label>{label}</Label><div><Val>{value ?? '—'}</Val></div></div>;
}

/* ── Property ──────────────────────────────────────────────────────────────── */

export function PropertySection({ property }: { property: OrderDetail['property'] }) {
  const [expanded, setExpanded] = useState(false);
  if (!property) return <Section><SH>Property</SH><p className="text-sm text-gray-400">No property data</p></Section>;

  const addr = [property.address, property.city, property.state, property.zip].filter(Boolean).join(', ') || '—';
  const legal = property.legalDescription;
  const isLong = legal && legal.length > 150;

  return (
    <Section>
      <SH>Property</SH>
      <div className="space-y-2">
        <Row label="Address" value={addr} />
        <div className="grid grid-cols-2 gap-x-8">
          <Row label="County" value={property.county || '—'} />
          <Row label="APN" value={property.apn || '—'} />
        </div>
        <Row label="Property Type" value={property.propertyType || '—'} />
        <div>
          <Label>Legal Description</Label>
          <div className={`text-sm font-medium text-[#1A1A2E] ${!expanded && isLong ? 'line-clamp-3' : ''}`}>
            {legal || '—'}
          </div>
          {isLong && (
            <button onClick={() => setExpanded(!expanded)} className="text-xs text-[#1B2A4A] font-medium mt-0.5 hover:underline">
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}

/* ── Transaction ───────────────────────────────────────────────────────────── */

export function TransactionSection({ order }: { order: OrderDetail['order'] }) {
  const price = order.salesPrice != null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(order.salesPrice)
    : '—';
  return (
    <Section>
      <SH>Transaction</SH>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        <Row label="Type" value={order.transactionType || '—'} />
        <Row label="Product Type" value={order.productType || '—'} />
        <Row label="Sales Price" value={price} />
        <Row label="Source" value={order.source?.replace(/_/g, ' ') || '—'} />
      </div>
    </Section>
  );
}

/* ── Parties ───────────────────────────────────────────────────────────────── */

export function PartiesSection({ parties }: { parties: OrderDetail['parties'] }) {
  return (
    <Section>
      <SH>Parties</SH>
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        <PartyCard label="Buyer" party={parties.buyer} />
        <PartyCard label="Seller" party={parties.seller} isOrg={parties.seller?.isOrganization} />
        <PartyCard label="Escrow Officer" party={parties.escrowOfficer} />
        <PartyCard label="Lender" party={parties.lender} />
        <PartyCard label="Listing Agent" party={parties.listingAgent} />
        <div className="space-y-4">
          <PartyCard label="Title Company" party={parties.titleCompany} />
          <PartyCard label="Underwriter" party={parties.underwriter} />
        </div>
      </div>
    </Section>
  );
}

function PartyCard({ label, party, isOrg }: { label: string; party: Party | null; isOrg?: boolean }) {
  const name = party
    ? (party.name || [party.firstName, party.lastName].filter(Boolean).join(' ') || '—')
    : '—';
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Label>{label}</Label>
        {isOrg && <span className="text-[10px] font-medium px-1.5 py-0 rounded bg-amber-100 text-amber-700">Organization</span>}
      </div>
      <Val>{name}</Val>
      {party && (
        <div className="text-xs text-gray-500 mt-0.5 space-y-px">
          {party.email && <div>{party.email}</div>}
          {party.phone && <div>{party.phone}</div>}
          {party.company && <div>{party.company}</div>}
        </div>
      )}
    </div>
  );
}

/* ── Assignments ───────────────────────────────────────────────────────────── */

export function AssignmentsSection({ assignments }: { assignments: OrderDetail['assignments'] }) {
  return (
    <Section>
      <SH>Assignments</SH>
      <div className="flex gap-8">
        <AssignmentPill label="Sales Rep" value={assignments.salesRep?.name} />
        <AssignmentPill label="Title Officer" value={assignments.titleOfficer?.name} />
        <AssignmentPill label="Created By" value={assignments.createdBy?.name} />
      </div>
    </Section>
  );
}

function AssignmentPill({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <Val>{value || '—'}</Val>
    </div>
  );
}

/* ── Documents ─────────────────────────────────────────────────────────────── */

const CAT_COLORS: Record<string, [string, string]> = {
  legal_vesting: ['LV', 'bg-blue-100 text-blue-700'],
  tax: ['Tax', 'bg-green-100 text-green-700'],
  grant_deed: ['Grant Deed', 'bg-amber-100 text-amber-700'],
  cpl: ['CPL', 'bg-purple-100 text-purple-700'],
  proposed_insured: ['PI', 'bg-teal-100 text-teal-700'],
};

export function DocumentsSection({ documents }: { documents: OrderDetail['documents'] }) {
  return (
    <Section>
      <SH>Documents</SH>
      {documents.count === 0 ? (
        <p className="text-sm text-gray-400">No documents</p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Val>{documents.count} document{documents.count !== 1 ? 's' : ''}</Val>
          {documents.categories.map(cat => {
            const [short, cls] = CAT_COLORS[cat] ?? [cat.replace(/_/g, ' '), 'bg-gray-100 text-gray-600'];
            return <span key={cat} className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium capitalize ${cls}`}>{short}</span>;
          })}
        </div>
      )}
    </Section>
  );
}

/* ── Status History ────────────────────────────────────────────────────────── */

export function StatusHistorySection({ history }: { history: OrderDetail['statusHistory'] }) {
  const sorted = [...history].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return (
    <div>
      <SH>Status History</SH>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">No status history</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((entry, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <StatusBadge status={entry.status} />
              <span className="text-gray-500 text-xs">{entry.source?.replace(/_/g, ' ') || '—'}</span>
              {entry.note && <span className="text-gray-400 text-xs italic truncate max-w-[200px]" title={entry.note}>{entry.note}</span>}
              <span className="text-gray-400 text-xs ml-auto whitespace-nowrap">{fmtTime(entry.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────────────── */

export function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Block h="h-4 w-48" rows={[['h-4 w-full'], ['h-4 w-32', 'h-4 w-28'], ['h-4 w-24'], ['h-4 w-full']]} />
      <Block h="h-4 w-36" rows={[['h-4 w-28', 'h-4 w-32'], ['h-4 w-24', 'h-4 w-20']]} />
      <Block h="h-4 w-24" rows={[['h-4 w-40', 'h-4 w-36'], ['h-4 w-32', 'h-4 w-28'], ['h-4 w-36', 'h-4 w-20']]} />
      <div className="flex gap-8">{[1, 2, 3].map(i => <div key={i}><div className="h-3 w-16 bg-gray-200 rounded mb-1" /><div className="h-4 w-24 bg-gray-200 rounded" /></div>)}</div>
      <div className="h-4 w-32 bg-gray-200 rounded" />
    </div>
  );
}

function Block({ h, rows }: { h: string; rows: string[][] }) {
  return (
    <div className="border-b border-gray-100 pb-4 mb-4">
      <div className={`${h} bg-gray-200 rounded mb-3`} />
      <div className="space-y-2">
        {rows.map((cols, ri) => (
          <div key={ri} className={cols.length > 1 ? 'grid grid-cols-2 gap-x-8' : ''}>
            {cols.map((c, ci) => <div key={ci} className={`${c} bg-gray-100 rounded`} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function Section({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-gray-100 pb-4 mb-4">{children}</div>;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}
