'use client';

import { useState, useEffect } from 'react';
import { ModalShell } from './modal-shell';

interface PrelimDoc { id: number; fileName: string; createdAt: string; }

export function PrelimModal({ open, onClose, orderId, fileNumber, address }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
}) {
  const [checking, setChecking] = useState(false);
  const [docs, setDocs] = useState<PrelimDoc[]>([]);
  const [fetchResult, setFetchResult] = useState<{ found: number } | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    setFetchResult(null); setError('');
    fetch(`/api/orders/${orderId}/documents?category=prelim`)
      .then((r) => r.ok ? r.json() : { documents: [] })
      .then((d) => setDocs(d.documents ?? []))
      .catch(() => setDocs([]))
      .finally(() => setLoaded(true));
  }, [open, orderId]);

  async function checkPrelim() {
    setChecking(true); setError(''); setFetchResult(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/fetch-prelim`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Check failed');
      setFetchResult({ found: body.documentsFound ?? 0 });
      if (body.documentsFound > 0) {
        const r2 = await fetch(`/api/orders/${orderId}/documents?category=prelim`);
        const d2 = await r2.json();
        setDocs(d2.documents ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setChecking(false);
    }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Prelim Documents" subtitle={`${fileNumber} · ${address}`}>
      <div className="p-5 space-y-4">
        <button
          onClick={checkPrelim}
          disabled={checking}
          className="w-full h-10 bg-[#1B2A4A] text-white text-sm font-medium rounded-lg hover:bg-[#16233D] disabled:opacity-50 transition-colors"
        >
          {checking ? 'Checking SoftPro…' : 'Check for Prelim'}
        </button>

        {fetchResult && (
          <div className={`px-3 py-2 rounded-lg text-sm ${fetchResult.found > 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            {fetchResult.found > 0 ? `Found ${fetchResult.found} document(s)` : 'No prelim available yet in SoftPro'}
          </div>
        )}

        {error && <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

        {docs.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Existing Prelim Documents</p>
            <div className="space-y-1.5">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-sm text-[#1A1A2E] truncate">{d.fileName}</p>
                    <p className="text-xs text-[#6B7280]">{new Date(d.createdAt).toLocaleDateString()}</p>
                  </div>
                  <a href={`/api/documents/${d.id}/download`} className="text-xs font-medium text-[#C5A55A] hover:text-[#B8953D] ml-3 shrink-0">Download</a>
                </div>
              ))}
            </div>
          </div>
        )}

        {loaded && docs.length === 0 && !fetchResult && (
          <p className="text-sm text-[#6B7280] text-center py-3">No prelim documents on file.</p>
        )}
      </div>
    </ModalShell>
  );
}
