'use client';

import { useCallback, useEffect, useState } from 'react';
import { DocumentUploadForm } from './document-upload-form';
import { DocumentRow } from './document-row';
import type { Document } from './document-row';

interface DocumentListResponse {
  documents: Document[];
}

export default function OrderDocuments({ orderId }: { orderId: number }) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [prelimFetching, setPrelimFetching] = useState(false);
  const [prelimResult, setPrelimResult] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  const fetchDocs = useCallback(() => {
    setLoading(true);
    setFetchError(null);
    fetch(`/api/orders/${orderId}/documents`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
        return res.json() as Promise<DocumentListResponse>;
      })
      .then((data) => setDocs(data.documents))
      .catch((err) => setFetchError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  async function handleRetrievePrelim() {
    setPrelimFetching(true);
    setPrelimResult(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/fetch-prelim`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Prelim retrieval failed (${res.status})`);
      const count = body?.documentsFound ?? 0;
      if (count > 0) {
        setPrelimResult({ type: 'success', message: `Found ${count} document${count > 1 ? 's' : ''}` });
        fetchDocs();
      } else {
        setPrelimResult({ type: 'info', message: 'No prelim available yet in SoftPro' });
      }
    } catch (err) {
      setPrelimResult({ type: 'error', message: err instanceof Error ? err.message : 'Prelim retrieval failed' });
    } finally {
      setPrelimFetching(false);
    }
  }

  return (
    <div className="p-6">
      <DocumentUploadForm orderId={orderId} onUploadSuccess={fetchDocs} />

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Documents</h3>
          <button
            onClick={handleRetrievePrelim}
            disabled={prelimFetching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-[#1B2A4A] rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {prelimFetching ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Checking SoftPro for prelim…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Retrieve Prelim
              </>
            )}
          </button>
        </div>

        {prelimResult && (
          <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium ${
            prelimResult.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700'
            : prelimResult.type === 'info' ? 'bg-blue-50 border border-blue-200 text-blue-700'
            : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {prelimResult.message}
          </div>
        )}

        {fetchError ? (
          <div className="p-6 text-center">
            <p className="text-red-600 text-sm font-medium">{fetchError}</p>
            <button onClick={fetchDocs} className="mt-2 text-sm text-[#1B2A4A] hover:underline">Retry</button>
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-gray-200 rounded-lg">
            <p className="text-sm text-[#6B7280]">No documents yet. Upload the first one above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/60">
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Filename</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Category</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Size</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Uploaded By</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">SoftPro</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} onRefresh={fetchDocs} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
