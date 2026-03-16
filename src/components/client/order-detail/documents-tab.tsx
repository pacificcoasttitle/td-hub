'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORY_LABELS, formatDate, formatFileSize } from './helpers';

interface Document {
  id: number;
  filename: string;
  category: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

const UPLOAD_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'curative', label: 'Curative' },
  { value: 'user_upload', label: 'Supporting Document' },
];

export function DocumentsTab({ documents, orderId }: { documents: Document[]; orderId?: number }) {
  const [docs, setDocs] = useState(documents);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [category, setCategory] = useState('general');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshDocs = useCallback(() => {
    if (!orderId) return;
    fetch(`/api/client/orders/${orderId}/documents`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.documents) setDocs(d.documents); })
      .catch(() => {});
  }, [orderId]);

  useEffect(() => { setDocs(documents); }, [documents]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0 || !orderId) return;
    setUploading(true);
    setUploadResult(null);
    const formData = new FormData();
    formData.append('file', files[0]);
    formData.append('category', category);
    try {
      const res = await fetch(`/api/client/orders/${orderId}/documents/upload`, { method: 'POST', body: formData });
      if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `Upload failed (${res.status})`); }
      setUploadResult({ type: 'success', message: 'Document uploaded successfully' });
      refreshDocs();
    } catch (err) {
      setUploadResult({ type: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  return (
    <div>
      {/* Upload zone */}
      {orderId && (
        <div className="p-4 sm:p-5 border-b border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Upload Document</p>
          <div className="flex items-center gap-3 mb-3">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20">
              {UPLOAD_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors min-h-[80px] flex flex-col items-center justify-center ${
              dragOver ? 'border-[#1B2A4A] bg-[#1B2A4A]/5' : 'border-gray-200 hover:border-[#1B2A4A]/40'
            }`}
          >
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => handleUpload(e.target.files)} />
            {uploading ? (
              <p className="text-sm text-[#6B7280]">Uploading…</p>
            ) : (
              <>
                <svg className="h-6 w-6 text-[#9CA3AF] mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[#6B7280]">Drop a file here or <span className="text-[#1B2A4A] font-medium">browse</span></p>
              </>
            )}
          </div>
          {uploadResult && (
            <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
              uploadResult.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
            }`}>{uploadResult.message}</div>
          )}
        </div>
      )}

      {/* Document list */}
      {docs.length === 0 ? (
        <div className="p-6 text-center py-12">
          <svg className="mx-auto h-8 w-8 text-[#9CA3AF] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm text-[#6B7280]">No documents available for this order.</p>
        </div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Document</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Category</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Size</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-[#6B7280] uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-[#6B7280] uppercase tracking-wider" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4"><span className="font-medium text-[#1A1A2E] truncate max-w-xs block">{doc.filename}</span></td>
                    <td className="px-5 py-4"><span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-[#374151]">{CATEGORY_LABELS[doc.category ?? ''] ?? doc.category ?? '—'}</span></td>
                    <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{formatFileSize(doc.sizeBytes)}</td>
                    <td className="px-5 py-4 text-[#6B7280] whitespace-nowrap">{formatDate(doc.createdAt)}</td>
                    <td className="px-5 py-4 text-right">
                      <a href={`/api/documents/${doc.id}/download`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1B2A4A] hover:underline">Download</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile */}
          <div className="sm:hidden divide-y divide-gray-100">
            {docs.map((doc) => (
              <div key={doc.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1A1A2E] truncate">{doc.filename}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-[#374151]">{CATEGORY_LABELS[doc.category ?? ''] ?? doc.category ?? '—'}</span>
                      <span className="text-xs text-[#6B7280]">{formatFileSize(doc.sizeBytes)}</span>
                    </div>
                  </div>
                  <a href={`/api/documents/${doc.id}/download`} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#1B2A4A] bg-[#1B2A4A]/5 rounded-lg hover:bg-[#1B2A4A]/10 transition-colors min-h-[44px] flex-shrink-0">Download</a>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
