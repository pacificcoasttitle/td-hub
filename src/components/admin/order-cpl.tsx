'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { softProSyncLabel } from '@/lib/domain/documents/softpro-attach-verify';

interface CplDocument {
  id: number;
  filename: string;
  originalFilename: string | null;
  category: string;
  sizeBytes: number | null;
  createdAt: string;
  isSyncedToSoftpro: boolean;
  softproSyncError?: string | null;
  softproListingConfirmed?: boolean | null;
}

export default function OrderCpl({ orderId, fileNumber }: { orderId: number; fileNumber: string }) {
  const [docs, setDocs] = useState<CplDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCpls = useCallback(() => {
    setLoading(true);
    fetch(`/api/orders/${orderId}/documents`)
      .then((r) => r.ok ? r.json() : { documents: [] })
      .then((d) => setDocs((d.documents ?? []).filter((doc: CplDocument) => doc.category === 'cpl')))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    fetchCpls();
  }, [fetchCpls]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
            CPL Documents
          </h3>
          <p className="text-sm text-[#6B7280] mt-0.5">
            Closing Protection Letters for this order
          </p>
        </div>
        <Link
          href={`/vendor-actions?tab=cpl&orderId=${orderId}`}
          className="px-3 py-1.5 text-sm font-medium bg-[#C5A55A] text-white rounded-lg hover:bg-[#b3923e] transition-colors inline-flex items-center gap-1.5"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Generate CPL
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="py-10 text-center border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm text-[#6B7280]">
            No CPL documents yet for {fileNumber}.
          </p>
          <Link
            href={`/vendor-actions?tab=cpl&orderId=${orderId}`}
            className="text-sm text-[#C5A55A] hover:underline mt-1 inline-block"
          >
            Generate the first CPL →
          </Link>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60">
                <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Filename</th>
                <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Size</th>
                <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">Date</th>
                <th className="text-left px-4 py-2.5 font-medium text-[#6B7280]">SoftPro</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {docs.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-[#1A1A2E]">
                    {doc.originalFilename ?? doc.filename}
                  </td>
                  <td className="px-4 py-3 text-[#6B7280]">
                    {doc.sizeBytes != null ? formatFileSize(doc.sizeBytes) : '—'}
                  </td>
                  <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(doc.createdAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {doc.isSyncedToSoftpro ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {softProSyncLabel(doc)}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-amber-700" title={doc.softproSyncError ?? undefined}>
                        Not in SoftPro
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`/api/documents/${doc.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-[#1B2A4A] hover:text-[#C5A55A] transition-colors"
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}
