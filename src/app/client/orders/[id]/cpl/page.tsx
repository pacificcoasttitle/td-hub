'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDate, formatFileSize } from '@/components/client/order-detail/helpers';

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
  { value: 'westcor', label: 'Westcor' },
  { value: 'fnf', label: 'FNF / Commonwealth' },
  { value: 'natic', label: 'NATIC' },
  { value: 'doma', label: 'Doma' },
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
      <div className="px-1 sm:px-0">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="bg-white rounded-lg border border-gray-200 p-8"><div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div></div>
      </div>
    );
  }

  return (
    <div className="px-1 sm:px-0">
      <Link href={`/client/orders/${orderId}`} className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors mb-4 min-h-[44px]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back to order
      </Link>

      <h1 className="text-xl sm:text-2xl font-semibold text-[#1A1A2E] mb-1">
        Generate CPL {order?.fileNumber && <span className="text-[#6B7280]">— {order.fileNumber}</span>}
      </h1>
      <p className="text-sm text-[#6B7280] mb-6">Closing Protection Letter</p>

      {/* Generate form */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-4">Generate New CPL</p>
        <div className="max-w-xs mb-4">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">Underwriter</label>
          <select
            value={underwriter}
            onChange={(e) => setUnderwriter(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
          >
            <option value="">Select underwriter…</option>
            {UNDERWRITERS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating || !underwriter}
          className="px-5 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors min-h-[44px] inline-flex items-center gap-2"
        >
          {generating ? 'Generating…' : 'Generate CPL'}
        </button>
        {result && (
          <div className={`mt-4 px-4 py-3 rounded-lg text-sm ${
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

      {/* Existing CPLs */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-[#1A1A2E]">Existing CPL Documents</h2>
        </div>
        {docs.length === 0 ? (
          <div className="p-8 text-center"><p className="text-sm text-[#6B7280]">No CPL documents generated yet.</p></div>
        ) : (
          <div className="divide-y divide-gray-100">
            {docs.map((doc) => (
              <div key={doc.id} className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#1A1A2E] truncate">{doc.filename}</p>
                  <p className="text-xs text-[#6B7280]">{formatDate(doc.createdAt)}{doc.sizeBytes ? ` · ${formatFileSize(doc.sizeBytes)}` : ''}</p>
                </div>
                <a href={`/api/documents/${doc.id}/download`} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#1B2A4A] bg-[#1B2A4A]/5 rounded-lg hover:bg-[#1B2A4A]/10 transition-colors min-h-[44px] flex-shrink-0">
                  Download
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
