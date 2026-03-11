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

  return (
    <div className="p-6">
      <DocumentUploadForm orderId={orderId} onUploadSuccess={fetchDocs} />

      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Documents</h3>

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
