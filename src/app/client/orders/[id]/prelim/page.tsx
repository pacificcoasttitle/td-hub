'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDate, formatFileSize } from '@/components/client/order-detail/helpers';

interface PrelimDoc {
  id: number;
  filename: string;
  sizeBytes: number | null;
  createdAt: string;
}

interface Note {
  id: number;
  content: string;
  createdAt: string;
  author: string;
}

export default function ClientPrelimPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [docs, setDocs] = useState<PrelimDoc[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [fileNumber, setFileNumber] = useState('');
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteResult, setNoteResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/client/orders/${orderId}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/client/orders/${orderId}/documents`).then((r) => r.ok ? r.json() : { documents: [] }),
      fetch(`/api/client/orders/${orderId}/notes`).then((r) => r.ok ? r.json() : { notes: [] }),
    ])
      .then(([o, d, n]) => {
        if (o) setFileNumber(o.fileNumber);
        setDocs((d?.documents ?? []).filter((doc: any) => doc.category === 'prelim'));
        setNotes(n?.notes ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orderId]);

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setSavingNote(true);
    setNoteResult(null);
    try {
      const res = await fetch(`/api/client/orders/${orderId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteText.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save note');
      const body = await res.json().catch(() => null);
      if (body?.note) setNotes((prev) => [body.note, ...prev]);
      setNoteText('');
      setNoteResult({ type: 'success', message: 'Note added' });
    } catch {
      setNoteResult({ type: 'error', message: 'Failed to save note' });
    } finally {
      setSavingNote(false);
    }
  }

  async function handleRequestPrelim() {
    setFetching(true);
    setFetchResult(null);
    try {
      const res = await fetch(`/api/client/orders/${orderId}/prelim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Request failed');
      const count = body?.documentsFound ?? 0;
      if (count > 0) {
        setFetchResult({ type: 'success', message: `Found ${count} document${count > 1 ? 's' : ''}` });
        fetch(`/api/client/orders/${orderId}/documents`).then((r) => r.ok ? r.json() : null).then((d) => {
          if (d?.documents) setDocs(d.documents.filter((doc: any) => doc.category === 'prelim'));
        }).catch(() => {});
      } else {
        setFetchResult({ type: 'info', message: 'No prelim available yet in SoftPro' });
      }
    } catch (err) {
      setFetchResult({ type: 'error', message: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setFetching(false);
    }
  }

  if (loading) {
    return (
      <div className="px-1 sm:px-0">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="bg-white rounded-lg border border-gray-200 p-8"><div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}</div></div>
      </div>
    );
  }

  return (
    <div className="px-1 sm:px-0">
      <Link href={`/client/orders/${orderId}`} className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A2E] transition-colors mb-4 min-h-[44px]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back to order
      </Link>

      <h1 className="text-xl sm:text-2xl font-semibold text-[#1A1A2E] mb-1">
        Preliminary Report {fileNumber && <span className="text-[#6B7280]">— {fileNumber}</span>}
      </h1>
      <p className="text-sm text-[#6B7280] mb-6">Review and download your preliminary title report</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Documents */}
        <div className="lg:col-span-2 space-y-6">
          {/* Prelim docs */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-[#1A1A2E]">Prelim Documents</h2>
              <button
                onClick={handleRequestPrelim}
                disabled={fetching}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-[#1B2A4A] rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {fetching ? 'Checking…' : 'Request Updated Prelim'}
              </button>
            </div>
            {fetchResult && (
              <div className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
                fetchResult.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700'
                : fetchResult.type === 'info' ? 'bg-blue-50 border border-blue-200 text-blue-700'
                : 'bg-red-50 border border-red-200 text-red-700'
              }`}>{fetchResult.message}</div>
            )}
            {docs.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="mx-auto h-8 w-8 text-[#9CA3AF] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm text-[#6B7280]">No prelim received yet.</p>
                <p className="text-xs text-[#6B7280] mt-1">It will appear here once available from SoftPro.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {docs.map((doc) => (
                  <div key={doc.id} className="px-5 py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1A1A2E] truncate">{doc.filename}</p>
                      <p className="text-xs text-[#6B7280]">{formatDate(doc.createdAt)}{doc.sizeBytes ? ` · ${formatFileSize(doc.sizeBytes)}` : ''}</p>
                    </div>
                    <a href={`/api/documents/${doc.id}/download`} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-white bg-[#1B2A4A] rounded-lg hover:bg-[#243658] transition-colors min-h-[44px] flex-shrink-0">
                      View / Download
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* TESSA placeholder */}
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#1B2A4A]/10 flex items-center justify-center flex-shrink-0">
                <svg className="h-5 w-5 text-[#1B2A4A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[#1A1A2E]">AI Analysis</p>
                <p className="text-xs text-[#6B7280]">Automated prelim analysis coming soon</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Notes */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-[#1A1A2E]">Notes</h2>
            </div>
            <div className="p-4">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note about this prelim…"
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm resize-none min-h-[80px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
              />
              <button
                onClick={handleAddNote}
                disabled={savingNote || !noteText.trim()}
                className="mt-2 px-4 py-2.5 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] disabled:opacity-50 transition-colors min-h-[44px] w-full"
              >
                {savingNote ? 'Saving…' : 'Add Note'}
              </button>
              {noteResult && (
                <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-medium ${
                  noteResult.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>{noteResult.message}</div>
              )}
            </div>
            {notes.length > 0 && (
              <div className="border-t border-gray-200 divide-y divide-gray-100 max-h-80 overflow-y-auto">
                {notes.map((n) => (
                  <div key={n.id} className="px-4 py-3">
                    <p className="text-sm text-[#1A1A2E] whitespace-pre-wrap">{n.content}</p>
                    <p className="text-xs text-[#6B7280] mt-1">{n.author} · {formatDate(n.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
            {notes.length === 0 && (
              <div className="px-4 pb-4"><p className="text-xs text-[#6B7280] text-center">No notes yet.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
