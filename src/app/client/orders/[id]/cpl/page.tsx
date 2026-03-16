'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDate, formatFileSize } from '@/components/client/order-detail/helpers';
import { EmptyState } from '@/components/client/empty-state';

interface CplDoc {
  id: number;
  filename: string;
  sizeBytes: number | null;
  createdAt: string;
}

interface OrderInfo {
  fileNumber: string;
  underwriter: string | null;
}

const UNDERWRITERS = [
  { value: 'westcor', label: 'Westcor', abbr: 'WC' },
  { value: 'fnf', label: 'FNF / Commonwealth', abbr: 'FN' },
  { value: 'natic', label: 'NATIC', abbr: 'NA' },
];

export default function ClientCplPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [docs, setDocs] = useState<CplDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [underwriter, setUnderwriter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string; docId?: number } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/client/orders/${orderId}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/client/orders/${orderId}/documents`).then((r) => r.ok ? r.json() : { documents: [] }),
    ])
      .then(([o, d]) => {
        if (o) { setOrder({ fileNumber: o.fileNumber, underwriter: o.underwriter ?? null }); setUnderwriter(o.underwriter ?? ''); }
        const cplDocs = (d.documents ?? []).filter((doc: any) => doc.category === 'cpl');
        setDocs(cplDocs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orderId]);

  async function handleGenerate() {
    setGenerating(true);
    setResult(null);
    try {
      const res = await fetch(`/api/client/orders/${orderId}/cpl/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ underwriter }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `CPL generation failed (${res.status})`);
      setResult({ type: 'success', message: 'Your CPL has been generated.', docId: body.documentId });
      fetch(`/api/client/orders/${orderId}/documents`).then((r) => r.ok ? r.json() : null).then((d) => {
        if (d?.documents) setDocs(d.documents.filter((doc: any) => doc.category === 'cpl'));
      }).catch(() => {});
    } catch (err) {
      setResult({ type: 'error', message: err instanceof Error ? err.message : 'CPL generation failed' });
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto animate-pulse">
        <div className="h-4 w-28 bg-gray-100 rounded mb-6" />
        <div className="h-8 w-56 bg-gray-100 rounded mb-6" />
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-8"><div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl" />)}</div></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link href={`/client/orders/${orderId}`} className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#1B2A4A] transition-colors mb-6 min-h-[44px]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back to order
      </Link>

      <h1 className="text-2xl sm:text-3xl font-semibold text-[#1B2A4A] mb-1">Generate CPL</h1>
      <p className="text-[#4B5563] mb-8">
        {order?.fileNumber && <><span className="font-mono text-sm">{order.fileNumber}</span> &middot; </>}
        Closing Protection Letter
      </p>

      {/* Existing CPLs */}
      {docs.length > 0 && (
        <div className="mb-8 space-y-3">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#E5E7EB]">
              <div className="flex-shrink-0 p-3 bg-[#D1FAE5] rounded-lg">
                <svg className="h-5 w-5 text-[#059669]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[#1B2A4A] truncate">{doc.filename}</p>
                <p className="text-xs text-[#6B7280]">{formatDate(doc.createdAt)}{doc.sizeBytes ? ` · ${formatFileSize(doc.sizeBytes)}` : ''}</p>
              </div>
              <a href={`/api/documents/${doc.id}/download`} className="flex-shrink-0 px-4 py-2 text-sm font-medium border border-[#F26B2B] text-[#F26B2B] rounded-lg hover:bg-[#F26B2B]/5 transition-colors inline-flex items-center gap-1.5">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Download
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Generate Form */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-6">
        <h3 className="font-semibold text-[#1B2A4A] mb-2">Generate New CPL</h3>
        <p className="text-sm text-[#4B5563] mb-6">Select an underwriter to generate your CPL</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {UNDERWRITERS.map((uw) => (
            <button
              key={uw.value}
              onClick={() => setUnderwriter(uw.value)}
              className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                underwriter === uw.value ? 'border-[#F26B2B] bg-[#F26B2B]/5' : 'border-[#E5E7EB] hover:border-[#D1D5DB]'
              }`}
            >
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-sm ${
                underwriter === uw.value ? 'bg-[#1B2A4A] text-white' : 'bg-[#F3F4F6] text-[#4B5563]'
              }`}>
                {uw.abbr}
              </div>
              <div className="flex-1">
                <p className="font-medium text-[#1B2A4A]">{uw.label}</p>
              </div>
              {underwriter === uw.value && (
                <svg className="h-5 w-5 text-[#F26B2B] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || !underwriter}
          className="w-full px-5 py-3 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-12 inline-flex items-center justify-center gap-2"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          {generating ? 'Generating…' : 'Generate CPL'}
        </button>

        {result && (
          <div className={`mt-4 px-4 py-3 rounded-xl text-sm ${
            result.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            <p>{result.message}</p>
            {result.docId && (
              <a href={`/api/documents/${result.docId}/download`} className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-green-800 hover:underline min-h-[44px]">
                Download CPL →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
