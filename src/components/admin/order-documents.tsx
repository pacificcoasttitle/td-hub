'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

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

interface DocumentListResponse {
  documents: Document[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'cpl', label: 'CPL' },
  { value: 'prelim', label: 'Preliminary Report' },
  { value: 'policy', label: 'Policy' },
  { value: 'legal_vesting', label: 'Legal / Vesting' },
  { value: 'grant_deed', label: 'Grant Deed' },
  { value: 'tax', label: 'Tax' },
  { value: 'user_upload', label: 'User Upload' },
] as const;

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

// ─── Component ──────────────────────────────────────────────────────────────

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
      <UploadSection orderId={orderId} onUploadSuccess={fetchDocs} />

      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
          Documents
        </h3>

        {fetchError ? (
          <div className="p-6 text-center">
            <p className="text-red-600 text-sm font-medium">{fetchError}</p>
            <button
              onClick={fetchDocs}
              className="mt-2 text-sm text-[#1B2A4A] hover:underline"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-gray-200 rounded-lg">
            <p className="text-sm text-[#6B7280]">
              No documents yet. Upload the first one above.
            </p>
          </div>
        ) : (
          <DocumentTable documents={docs} onRefresh={fetchDocs} />
        )}
      </div>
    </div>
  );
}

// ─── Upload Section ─────────────────────────────────────────────────────────

function UploadSection({
  orderId,
  onUploadSuccess,
}: {
  orderId: number;
  onUploadSuccess: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  function handleFiles(files: FileList | null) {
    if (files && files.length > 0) {
      setFile(files[0]!);
      setFeedback(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setFeedback(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('orderId', String(orderId));
      formData.append('category', category);
      if (description.trim()) formData.append('description', description.trim());

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }

      setFile(null);
      setDescription('');
      setCategory('general');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFeedback({ type: 'success', message: 'Document uploaded successfully.' });
      onUploadSuccess();
      setTimeout(() => setFeedback(null), 4000);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
        Upload Document
      </h3>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-[#C5A55A] bg-[#C5A55A]/5'
            : file
              ? 'border-[#1B2A4A]/30 bg-[#1B2A4A]/[0.02]'
              : 'border-gray-200 hover:border-gray-300 bg-gray-50/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {file ? (
          <div className="flex items-center justify-center gap-2">
            <svg
              className="h-5 w-5 text-[#1B2A4A]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="text-sm font-medium text-[#1A1A2E]">
              {file.name}
            </span>
            <span className="text-xs text-[#6B7280]">
              ({formatFileSize(file.size)})
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="ml-2 text-[#6B7280] hover:text-red-500 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <svg
              className="mx-auto h-8 w-8 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="mt-2 text-sm text-[#6B7280]">
              <span className="font-medium text-[#1B2A4A]">Click to select</span>{' '}
              or drag and drop
            </p>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              PDF, DOC, DOCX, XLS, XLSX, TIF, PNG, JPG
            </p>
          </>
        )}
      </div>

      {/* Options row */}
      <div className="flex items-end gap-3 mt-3">
        <div className="flex-1 max-w-[200px]">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">
            Description <span className="font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]"
          />
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`mt-3 px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            className={`ml-4 ${
              feedback.type === 'success'
                ? 'text-green-400 hover:text-green-600'
                : 'text-red-400 hover:text-red-600'
            }`}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Document Table ─────────────────────────────────────────────────────────

function DocumentTable({ documents, onRefresh }: { documents: Document[]; onRefresh: () => void }) {
  return (
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
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onRefresh={onRefresh} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentRow({ doc, onRefresh }: { doc: Document; onRefresh: () => void }) {
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

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
            <span className="font-medium text-[#1A1A2E] truncate max-w-xs">
              {doc.originalFilename ?? doc.filename}
            </span>
          </div>
          {doc.description && (
            <p className="text-xs text-[#6B7280] mt-0.5 truncate max-w-xs">{doc.description}</p>
          )}
        </td>
        <td className="px-4 py-3 whitespace-nowrap"><CategoryBadge category={doc.category} /></td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">
          {doc.sizeBytes != null ? formatFileSize(doc.sizeBytes) : '—'}
        </td>
        <td className="px-4 py-3 text-[#1A1A2E] whitespace-nowrap">{doc.createdBy ?? '—'}</td>
        <td className="px-4 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(doc.createdAt)}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          {doc.isSyncedToSoftpro ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700" title={doc.softproSyncedAt ? `Synced ${formatDate(doc.softproSyncedAt)}` : undefined}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Synced
            </span>
          ) : (
            <button
              onClick={handleAttach}
              disabled={attaching}
              className="px-2 py-1 text-xs font-medium border border-[#1B2A4A] text-[#1B2A4A] rounded-md hover:bg-[#1B2A4A]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {attaching ? 'Attaching…' : 'Attach to SoftPro'}
            </button>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <a
            href={`/api/documents/${doc.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-[#1B2A4A] hover:text-[#C5A55A] transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </a>
        </td>
      </tr>
      {attachError && (
        <tr className="bg-red-50/40">
          <td colSpan={7} className="px-4 py-2">
            <p className="text-xs text-red-600">{attachError}</p>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Small UI pieces ────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] ?? 'bg-gray-100 text-gray-600';
  const label = category.replace(/_/g, ' ');
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${color}`}
    >
      {label}
    </span>
  );
}

function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff'].includes(ext);

  const color = isPdf
    ? 'text-red-400'
    : isImage
      ? 'text-blue-400'
      : 'text-gray-400';

  return (
    <svg
      className={`h-4 w-4 shrink-0 ${color}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}
