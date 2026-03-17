'use client';

import { useState, useEffect } from 'react';
import { ModalShell } from './modal-shell';

interface ProposedDoc { id: number; fileName: string; createdAt: string; }

export function ProposedInsuredModal({ open, onClose, orderId, fileNumber, address, accentColor }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  accentColor?: string;
}) {
  const [orderData, setOrderData] = useState<{ buyer?: string; lender?: string } | null>(null);
  const [docs, setDocs] = useState<ProposedDoc[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; docId?: number; error?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    Promise.all([
      fetch(`/api/orders/${orderId}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/orders/${orderId}/documents?category=proposed_insured`).then((r) => r.ok ? r.json() : { documents: [] }),
    ]).then(([order, docData]) => {
      if (order) {
        const buyer = [order.buyerFirstName, order.buyerLastName].filter(Boolean).join(' ');
        const lender = order.lenderName ?? order.lenderCompanyName ?? '';
        setOrderData({ buyer: buyer || undefined, lender: lender || undefined });
      }
      setDocs(docData?.documents ?? []);
    }).catch(() => {});
  }, [open, orderId]);

  async function generate() {
    setGenerating(true); setResult(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/proposed-insured`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Generation failed');
      setResult({ ok: true, docId: body.documentId });
      const r2 = await fetch(`/api/orders/${orderId}/documents?category=proposed_insured`);
      const d2 = await r2.json();
      setDocs(d2.documents ?? []);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    } finally { setGenerating(false); }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Proposed Insured" subtitle={`${fileNumber} · ${address}`} accentColor={accentColor}>
      <div className="p-5 space-y-4">
        {orderData && (
          <div className="grid grid-cols-2 gap-3">
            <div className="px-3 py-2.5 bg-gray-50 rounded-lg">
              <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">Buyer / Borrower</p>
              <p className="text-sm font-medium text-[#1A1A2E] mt-0.5">{orderData.buyer || '—'}</p>
            </div>
            <div className="px-3 py-2.5 bg-gray-50 rounded-lg">
              <p className="text-[10px] uppercase tracking-wider text-[#6B7280]">Lender</p>
              <p className="text-sm font-medium text-[#1A1A2E] mt-0.5">{orderData.lender || '—'}</p>
            </div>
          </div>
        )}
        <button onClick={generate} disabled={generating}
          className="w-full h-11 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
          {generating ? 'Generating…' : 'Generate Proposed Insured'}
        </button>
        {result && (
          <div className={`px-3 py-2 rounded-lg text-sm ${result.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {result.ok ? <span>Document generated. <a href={`/api/documents/${result.docId}/download`} className="underline font-semibold text-[#F26B2B]">Download</a></span> : result.error}
          </div>
        )}
        {docs.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Existing Documents</p>
            <div className="space-y-1.5">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-sm text-[#1A1A2E] truncate">{d.fileName}</p>
                    <p className="text-xs text-[#6B7280]">{new Date(d.createdAt).toLocaleDateString()}</p>
                  </div>
                  <a href={`/api/documents/${d.id}/download`} className="text-xs font-semibold ml-3 shrink-0 text-[#F26B2B] hover:text-[#E05A1A]">Download</a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
