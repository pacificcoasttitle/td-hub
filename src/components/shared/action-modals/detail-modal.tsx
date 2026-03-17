'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ModalShell } from './modal-shell';
import { ActivityFeed } from '@/components/shared/activity-feed';

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

interface Doc { id: number; fileName: string; category: string | null; createdAt: string; }

const TABS = ['Overview', 'Property', 'Parties', 'Documents', 'Activity'] as const;
type Tab = (typeof TABS)[number];

export function DetailModal({ open, onClose, orderId, fileNumber, address, isClient, accentColor }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  isClient?: boolean; accentColor?: string;
}) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  const base = isClient ? `/api/client/orders/${orderId}` : `/api/orders/${orderId}`;
  const detailHref = isClient ? `/client/orders/${orderId}` : `/orders/${orderId}`;

  useEffect(() => {
    if (!open) { setTab('Overview'); return; }
    setLoading(true);
    Promise.all([
      fetch(base).then((r) => r.ok ? r.json() : null),
      fetch(`${base}/documents`).then((r) => r.ok ? r.json() : { documents: [] }),
    ]).then(([o, d]) => { setOrder(o); setDocs(d?.documents ?? []); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [open, base]);

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
            {TABS.map((t) => (
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
              docs.length > 0 ? (
                <div className="space-y-1.5">
                  {docs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg">
                      <div className="min-w-0">
                        <p className="text-sm text-[#1A1A2E] truncate">{d.fileName}</p>
                        <p className="text-xs text-[#6B7280]">{d.category ?? 'general'} · {new Date(d.createdAt).toLocaleDateString()}</p>
                      </div>
                      <a href={`/api/documents/${d.id}/download`} className="text-xs font-semibold ml-3 shrink-0 text-[#F26B2B] hover:text-[#E05A1A]">Download</a>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-[#6B7280] text-center py-4">No documents.</p>
            )}
            {tab === 'Activity' && (
              <ActivityFeed fetchUrl={`${base}/activity`} accentColor={accentColor} />
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

function F({ l, v }: { l: string; v: string }) {
  return <div className="px-3 py-2.5 bg-gray-50 rounded-lg"><p className="text-[10px] uppercase tracking-wider text-[#6B7280]">{l}</p><p className="text-sm font-medium text-[#1A1A2E] mt-0.5 truncate">{v}</p></div>;
}
