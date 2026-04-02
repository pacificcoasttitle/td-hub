'use client';

import { useCallback, useRef, useState } from 'react';

interface FileResult { name: string; ok: boolean; error?: string }

interface Props { onSuccess: () => void }

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadForm({ onSuccess }: Props) {
  const [orderNumber, setOrderNumber] = useState('');
  const [docName, setDocName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const pdfs = Array.from(list).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    setFiles(prev => [...prev, ...pdfs]);
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  async function handleSubmit() {
    setError('');
    setResults(null);
    if (!orderNumber.trim()) { setError('Order number is required.'); return; }
    if (!docName.trim()) { setError('Document name is required.'); return; }
    if (files.length === 0) { setError('At least one PDF file is required.'); return; }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('orderNumber', orderNumber.trim());
      fd.append('documentName', docName.trim());
      files.forEach(f => fd.append('files', f));

      const res = await fetch('/api/title-production/upload', { method: 'POST', body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Upload failed (${res.status})`);

      setResults(body?.results ?? files.map(f => ({ name: f.name, ok: true })));
      setOrderNumber('');
      setDocName('');
      setFiles([]);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
      <h2 className="text-lg font-semibold text-[#1B2A4A] mb-4">Upload Documents to SoftPro</h2>

      {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {results && (
        <div className="mb-4 space-y-1">
          {results.map((r, i) => (
            <div key={i} className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${r.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              <span>{r.ok ? '✅' : '❌'}</span>
              <span className="font-medium">{r.name}</span>
              {r.error && <span className="text-xs ml-1">— {r.error}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-[#1A1A2E] mb-1">Order Number</label>
          <input type="text" value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder="e.g. 2025-001234"
            className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/30 focus:border-[#F26B2B]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1A1A2E] mb-1">Document Name</label>
          <input type="text" value={docName} onChange={e => setDocName(e.target.value)} placeholder="e.g. Deed of Trust"
            className="w-full h-11 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/30 focus:border-[#F26B2B]" />
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`mb-4 border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors ${
          dragging ? 'border-[#F26B2B] bg-[#F26B2B]/5' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <svg className="h-10 w-10 text-[#9CA3AF] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-sm text-[#4B5563]">Drag PDF files here, or <span className="text-[#F26B2B] font-medium">Browse Files</span></p>
        <p className="text-xs text-[#9CA3AF] mt-1">PDF only — multiple files allowed</p>
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Selected files */}
      {files.length > 0 && (
        <div className="mb-4 space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
              <svg className="h-4 w-4 text-red-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M4 18h12a2 2 0 002-2V6l-4-4H4a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              <span className="text-sm text-[#1A1A2E] truncate flex-1">{f.name}</span>
              <span className="text-xs text-[#9CA3AF]">{fmtSize(f.size)}</span>
              <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="text-[#9CA3AF] hover:text-red-500 transition-colors">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={handleSubmit} disabled={uploading}
        className="w-full h-11 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2">
        {uploading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            Uploading…
          </>
        ) : 'Upload & Send to SoftPro'}
      </button>
    </div>
  );
}
