'use client';

import { useState, useEffect } from 'react';
import { ModalShell } from './modal-shell';

interface PrelimDoc { id: number; fileName: string; createdAt: string; }

function normalizeDocs(raw: Record<string, unknown>[]): PrelimDoc[] {
  return raw
    .filter((d: Record<string, unknown>) => !d.category || d.category === 'prelim')
    .map((d: Record<string, unknown>) => ({
      id: d.id as number,
      fileName: (d.fileName ?? d.filename ?? d.originalFilename ?? 'Document') as string,
      createdAt: d.createdAt as string,
    }));
}

/** Fetch prelim docs list and open the first one in a new tab. Returns true if opened. */
export async function openPrelimInNewTab(orderId: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/orders/${orderId}/documents?category=prelim`);
    if (!res.ok) return false;
    const data = await res.json();
    const docs = normalizeDocs(data.documents ?? []);
    if (docs.length === 0) return false;
    window.open(`/api/documents/${docs[0].id}/download`, '_blank');
    return true;
  } catch {
    return false;
  }
}

export function PrelimModal({ open, onClose, orderId, fileNumber, address, isClient, accentColor, hideFetch }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  isClient?: boolean; accentColor?: string;
  hideFetch?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [docs, setDocs] = useState<PrelimDoc[]>([]);
  const [fetchResult, setFetchResult] = useState<{ found: number } | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const base = isClient ? `/api/client/orders/${orderId}` : `/api/orders/${orderId}`;

  const docsUrl = isClient ? `${base}/prelim` : `${base}/documents?category=prelim`;
  const docsKey = isClient ? 'prelims' : 'documents';
  const dlBase = isClient ? '/api/client' : '/api';

  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    setFetchResult(null); setError('');
    fetch(docsUrl)
      .then((r) => r.ok ? r.json() : { [docsKey]: [] })
      .then((d) => setDocs(normalizeDocs(d[docsKey] ?? d.documents ?? [])))
      .catch(() => setDocs([]))
      .finally(() => setLoaded(true));
  }, [open, docsUrl, docsKey]);

  async function checkPrelim() {
    setChecking(true); setError(''); setFetchResult(null);
    try {
      const fetchUrl = isClient ? `${base}/prelim` : `${base}/fetch-prelim`;
      const fetchBody = isClient ? JSON.stringify({ action: 'fetch' }) : undefined;
      const fetchHeaders = isClient ? { 'Content-Type': 'application/json' } : undefined;
      const res = await fetch(fetchUrl, { method: 'POST', body: fetchBody, headers: fetchHeaders });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Check failed');
      setFetchResult({ found: body.documentsFound ?? body.documentsStored ?? 0 });
      if ((body.documentsFound ?? body.documentsStored ?? 0) > 0) {
        const r2 = await fetch(docsUrl);
        const d2 = await r2.json();
        setDocs(normalizeDocs(d2[docsKey] ?? d2.documents ?? []));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setChecking(false); }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Prelim Documents" subtitle={`${fileNumber} · ${address}`} accentColor={accentColor}>
      <div className="p-5 space-y-4">
        {!hideFetch && (
          <button onClick={checkPrelim} disabled={checking}
            className="w-full h-11 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
            {checking ? 'Checking SoftPro…' : 'Check for Prelim'}
          </button>
        )}
        {fetchResult && (
          <div className={`px-3 py-2 rounded-lg text-sm ${fetchResult.found > 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            {fetchResult.found > 0 ? `Found ${fetchResult.found} document(s)` : 'No prelim available yet in SoftPro'}
          </div>
        )}
        {error && <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}
        {docs.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Prelim Documents</p>
            <div className="space-y-1.5">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-sm text-[#1A1A2E] truncate">{d.fileName}</p>
                    <p className="text-xs text-[#6B7280]">{new Date(d.createdAt).toLocaleDateString()}</p>
                  </div>
                  <a href={`${dlBase}/documents/${d.id}/download`} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold ml-3 shrink-0 text-[#F26B2B] hover:text-[#E05A1A]">
                    View PDF
                  </a>
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
