'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDate, formatFileSize } from '@/components/client/order-detail/helpers';
import { EmptyState } from '@/components/client/empty-state';

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
      <div className="max-w-4xl mx-auto animate-pulse">
        <div className="h-4 w-28 bg-gray-100 rounded mb-6" />
        <div className="h-8 w-56 bg-gray-100 rounded mb-6" />
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-8"><div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded" />)}</div></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link href={`/client/orders/${orderId}`} className="inline-flex items-center gap-2 text-sm text-[#4B5563] hover:text-[#1B2A4A] transition-colors mb-6 min-h-[44px]">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back to order
      </Link>

      <h1 className="text-2xl sm:text-3xl font-semibold text-[#1B2A4A] mb-1">Preliminary Report</h1>
      <p className="text-[#4B5563] mb-8">
        {fileNumber && <><span className="font-mono text-sm">{fileNumber}</span> &middot; </>}
        Review and download your preliminary title report
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Documents */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
              <h2 className="font-semibold text-[#1B2A4A]">Prelim Documents</h2>
              <button
                onClick={handleRequestPrelim}
                disabled={fetching}
                className="px-4 py-2 text-sm font-medium border border-[#F26B2B] text-[#F26B2B] rounded-lg hover:bg-[#F26B2B]/5 disabled:opacity-50 transition-colors min-h-[40px]"
              >
                {fetching ? 'Checking…' : 'Request Updated Prelim'}
              </button>
            </div>
            {fetchResult && (
              <div className={`mx-6 mt-4 px-4 py-3 rounded-xl text-sm font-medium ${
                fetchResult.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700'
                : fetchResult.type === 'info' ? 'bg-blue-50 border border-blue-200 text-blue-700'
                : 'bg-red-50 border border-red-200 text-red-700'
              }`}>{fetchResult.message}</div>
            )}
            {docs.length === 0 ? (
              <EmptyState type="no-prelim" />
            ) : (
              <div className="divide-y divide-[#E5E7EB]">
                {docs.map((doc) => (
                  <div key={doc.id} className="px-6 py-4 flex items-center gap-4">
                    <div className="flex-shrink-0 p-3 bg-[#DBEAFE] rounded-lg">
                      <svg className="h-5 w-5 text-[#1E40AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[#1B2A4A] truncate">{doc.filename}</p>
                      <p className="text-xs text-[#6B7280]">{formatDate(doc.createdAt)}{doc.sizeBytes ? ` · ${formatFileSize(doc.sizeBytes)}` : ''}</p>
                    </div>
                    <a href={`/api/documents/${doc.id}/download`} className="flex-shrink-0 px-4 py-2 text-sm font-medium border border-[#F26B2B] text-[#F26B2B] rounded-lg hover:bg-[#F26B2B]/5 transition-colors inline-flex items-center gap-1.5 min-h-[40px]">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Download
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI Analysis placeholder */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#F3F4F6] flex items-center justify-center flex-shrink-0">
                <svg className="h-5 w-5 text-[#4B5563]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              </div>
              <div>
                <p className="font-medium text-[#1B2A4A]">AI Analysis</p>
                <p className="text-sm text-[#4B5563]">Automated prelim analysis coming soon</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Notes */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E7EB]">
              <h2 className="font-semibold text-[#1B2A4A]">Notes</h2>
            </div>
            <div className="p-5">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note about this prelim…"
                rows={3}
                className="w-full px-4 py-3 border border-[#E5E7EB] rounded-lg text-sm text-[#1B2A4A] placeholder:text-[#9CA3AF] resize-none focus:outline-none focus:ring-2 focus:ring-[#F26B2B]/20 focus:border-[#F26B2B]"
              />
              <button
                onClick={handleAddNote}
                disabled={savingNote || !noteText.trim()}
                className="mt-3 w-full px-4 py-2.5 text-sm font-medium bg-[#F26B2B] text-white rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {savingNote ? 'Saving…' : 'Add Note'}
              </button>
              {noteResult && (
                <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-medium ${
                  noteResult.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>{noteResult.message}</div>
              )}
            </div>
            {notes.length > 0 ? (
              <div className="border-t border-[#E5E7EB] divide-y divide-[#E5E7EB] max-h-80 overflow-y-auto">
                {notes.map((n) => (
                  <div key={n.id} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-[#1B2A4A]">{n.author}</span>
                      <span className="text-xs text-[#6B7280]">{formatDate(n.createdAt)}</span>
                    </div>
                    <p className="text-sm text-[#4B5563] whitespace-pre-wrap">{n.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 pb-4"><p className="text-xs text-[#6B7280] text-center">No notes yet.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
