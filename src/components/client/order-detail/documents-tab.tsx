'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORY_LABELS, CATEGORY_STYLES, formatDate, formatFileSize } from './helpers';
import { EmptyState } from '@/components/client/empty-state';

interface Document {
  id: number;
  filename: string;
  category: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

const UPLOAD_CATEGORIES = ['General', 'Curative', 'Supporting'];

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
    <div className="space-y-6">
      {/* Upload Zone */}
      {orderId && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragOver ? 'border-[#F26B2B] bg-[#F26B2B]/5' : 'border-[#D1D5DB] hover:border-[#9CA3AF]'
          }`}
        >
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => handleUpload(e.target.files)} />
          <svg className="h-10 w-10 text-[#9CA3AF] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {uploading ? (
            <p className="text-[#4B5563] mb-4">Uploading…</p>
          ) : (
            <p className="text-[#4B5563] mb-4">Drag and drop files here, or click to browse</p>
          )}
          <div className="flex items-center justify-center gap-2 mb-4">
            {UPLOAD_CATEGORIES.map((cat) => {
              const val = cat.toLowerCase() === 'supporting' ? 'user_upload' : cat.toLowerCase();
              return (
                <button
                  key={cat}
                  onClick={() => setCategory(val)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                    category === val ? 'bg-[#1B2A4A] text-white' : 'bg-[#F3F4F6] text-[#4B5563] hover:bg-[#E5E7EB]'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-5 py-2.5 text-sm font-medium border border-[#F26B2B] text-[#F26B2B] rounded-lg hover:bg-[#F26B2B]/5 transition-colors"
          >
            Browse Files
          </button>
        </div>
      )}

      {uploadResult && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          uploadResult.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
        }`}>{uploadResult.message}</div>
      )}

      {/* Document Cards */}
      {docs.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E7EB]">
          <EmptyState type="no-documents" />
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => {
            const catKey = doc.category ?? 'general';
            const catStyle = CATEGORY_STYLES[catKey] ?? 'bg-[#F3F4F6] text-[#4B5563]';
            return (
              <div key={doc.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[#E5E7EB]">
                <div className="flex-shrink-0 p-2.5 bg-[#F3F4F6] rounded-lg">
                  <svg className="h-5 w-5 text-[#4B5563]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[#1B2A4A] truncate">{doc.filename}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${catStyle}`}>
                      {CATEGORY_LABELS[catKey] ?? catKey}
                    </span>
                    <span className="text-xs text-[#6B7280]">{formatFileSize(doc.sizeBytes)}</span>
                    <span className="text-xs text-[#6B7280]">{formatDate(doc.createdAt)}</span>
                  </div>
                </div>
                <a
                  href={`/api/documents/${doc.id}/download`}
                  className="flex-shrink-0 px-4 py-2 text-sm font-medium border border-[#F26B2B] text-[#F26B2B] rounded-lg hover:bg-[#F26B2B]/5 transition-colors inline-flex items-center gap-1.5 min-h-[40px]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="hidden sm:inline">Download</span>
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
