'use client';

import { useState } from 'react';
import { formatFileSize } from './document-upload-form';
import { createdByVariant, formatCreatedBy } from '@/lib/domain/orders/created-by-display';

interface Document {
  id: number;
  filename: string;
  originalFilename: string | null;
  category: string;
  sizeBytes: number | null;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  isSyncedToSoftpro: boolean;
  softproSyncedAt: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  cpl: 'bg-purple-100 text-purple-800',
  prelim: 'bg-sky-100 text-sky-800',
  policy: 'bg-indigo-100 text-indigo-800',
  legal_vesting: 'bg-amber-100 text-amber-800',
  grant_deed: 'bg-emerald-100 text-emerald-800',
  tax: 'bg-rose-100 text-rose-800',
  general: 'bg-gray-100 text-gray-700',
  user_upload: 'bg-blue-100 text-blue-800',
  proposed_insured: 'bg-teal-100 text-teal-800',
  curative: 'bg-orange-100 text-orange-800',
};

export { type Document };

export function DocumentRow({ doc, onRefresh }: { doc: Document; onRefresh: () => void }) {
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const createdByDisplay = formatCreatedBy(doc.createdBy);
  const createdByClass = createdByVariant(doc.createdBy) === 'system'
    ? 'text-[#9CA3AF] italic'
    : 'text-[#1A1A2E]';

  async function handleAttach() {
    setAttaching(true);
    setAttachError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/attach`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Attach failed (${res.status})`);
      }
      onRefresh();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Attach failed');
      setTimeout(() => setAttachError(null), 5000);
    } finally {
      setAttaching(false);
    }
  }

  return (
    <>
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <FileIcon filename={doc.filename} />
            <span className="font-medium text-[#1A1A2E] truncate max-w-xs">{doc.originalFilename ?? doc.filename}</span>
          </div>
          {doc.description && <p className="text-xs text-[#6B7280] mt-0.5 truncate max-w-xs">{doc.description}</p>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap"><CategoryBadge category={doc.category} /></td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{doc.sizeBytes != null ? formatFileSize(doc.sizeBytes) : '—'}</td>
        <td className={`px-4 py-3 whitespace-nowrap ${createdByClass}`}>{createdByDisplay}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(doc.createdAt)}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {doc.isSyncedToSoftpro ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700" title={doc.softproSyncedAt ? `Synced ${formatDate(doc.softproSyncedAt)}` : undefined}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {formatCreatedBy(null)}
            </span>
          ) : (
            <button onClick={handleAttach} disabled={attaching}
              className="px-2 py-1 text-xs font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-md hover:bg-[#1B2A4A]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {attaching ? 'Attaching…' : 'Attach to SoftPro'}
            </button>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#1B2A4A] hover:text-[#C5A55A] transition-colors">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </a>
        </td>
      </tr>
      {attachError && (
        <tr className="bg-red-50/40">
          <td colSpan={7} className="px-4 py-2"><p className="text-xs text-red-600">{attachError}</p></td>
        </tr>
      )}
    </>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}>{category.replace(/_/g, ' ')}</span>;
}

function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff'].includes(ext);
  const color = isPdf ? 'text-red-400' : isImage ? 'text-blue-400' : 'text-gray-400';
  return (
    <svg className={`h-4 w-4 shrink-0 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}
