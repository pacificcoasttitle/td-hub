'use client';

import { useRef, useState } from 'react';

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

export function DocumentUploadForm({ orderId, onUploadSuccess }: { orderId: number; onUploadSuccess: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function handleFiles(files: FileList | null) {
    if (files && files.length > 0) { setFile(files[0]!); setFeedback(null); }
  }

  function handleDrop(e: React.DragEvent) { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setDragOver(false); }

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
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      setFile(null); setDescription(''); setCategory('general');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFeedback({ type: 'success', message: 'Document uploaded successfully.' });
      onUploadSuccess();
      setTimeout(() => setFeedback(null), 4000);
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Upload Document</h3>
      <div
        onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-[#C5A55A] bg-[#C5A55A]/5'
            : file ? 'border-[#1B2A4A]/30 bg-[#1B2A4A]/[0.02]' : 'border-gray-200 hover:border-gray-300 bg-gray-50/50'
        }`}
      >
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        {file ? (
          <div className="flex items-center justify-center gap-2">
            <svg className="h-5 w-5 text-[#1B2A4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium text-[#1A1A2E]">{file.name}</span>
            <span className="text-xs text-[#6B7280]">({formatFileSize(file.size)})</span>
            <button onClick={(e) => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              className="ml-2 text-[#6B7280] hover:text-red-500 transition-colors">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-2 text-sm text-[#6B7280]"><span className="font-medium text-[#1B2A4A]">Click to select</span> or drag and drop</p>
            <p className="mt-0.5 text-xs text-[#6B7280]">PDF, DOC, DOCX, XLS, XLSX, TIF, PNG, JPG</p>
          </>
        )}
      </div>
      <div className="flex items-end gap-3 mt-3">
        <div className="flex-1 max-w-[200px]">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]">
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-[#6B7280] mb-1">Description <span className="font-normal">(optional)</span></label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-[#1A1A2E] placeholder:text-[#6B7280] bg-white focus:outline-none focus:ring-2 focus:ring-[#C5A55A]/40 focus:border-[#C5A55A]" />
        </div>
        <button onClick={handleUpload} disabled={!file || uploading}
          className="px-4 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0">
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      {feedback && (
        <div className={`mt-3 px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${
          feedback.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)}
            className={`ml-4 ${feedback.type === 'success' ? 'text-green-400 hover:text-green-600' : 'text-red-400 hover:text-red-600'}`}>✕</button>
        </div>
      )}
    </div>
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
