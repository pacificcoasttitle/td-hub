'use client';

import { useState, useEffect } from 'react';
import { ModalShell } from './modal-shell';

interface Note { id: number; body: string; createdAt: string; authorName?: string | null; }

export function NotesModal({ open, onClose, orderId, fileNumber, address, isClient, accentColor }: {
  open: boolean; onClose: () => void;
  orderId: number; fileNumber: string; address: string;
  isClient?: boolean; accentColor?: string;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const base = isClient ? `/api/client/orders/${orderId}` : `/api/orders/${orderId}`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setNewNote('');
      setError('');
      setLoading(true);
    });
    fetch(`${base}/notes`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : { notes: [] })
      .then((d) => setNotes(d.notes ?? []))
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setNotes([]);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [open, base]);

  async function addNote() {
    if (!newNote.trim()) return;
    setSaving(true); setError('');
    try {
      const res = await fetch(`${base}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newNote.trim() }),
      });
      if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? 'Failed to add note'); }
      setNewNote('');
      const r2 = await fetch(`${base}/notes`);
      const d2 = await r2.json();
      setNotes(d2.notes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Order Notes" subtitle={`${fileNumber} · ${address}`} accentColor={accentColor}>
      <div className="p-5 space-y-4">
        {loading ? (
          <div className="py-10 text-center">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-[#F26B2B] rounded-full animate-spin mx-auto" />
            <p className="text-sm text-[#6B7280] mt-3">Loading notes…</p>
          </div>
        ) : (
          <>
            <div>
              <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Add a note…" rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20" />
              {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
              <button onClick={addNote} disabled={!newNote.trim() || saving}
                className="mt-2 px-4 h-9 bg-[#F26B2B] text-white text-sm font-semibold rounded-lg hover:bg-[#E05A1A] disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : 'Add Note'}
              </button>
            </div>
            {notes.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {notes.map((n) => (
                  <div key={n.id} className="px-3 py-2.5 bg-gray-50 rounded-lg">
                    <p className="text-sm text-[#1A1A2E] whitespace-pre-wrap">{n.body}</p>
                    <p className="text-[10px] text-[#6B7280] mt-1">{new Date(n.createdAt).toLocaleString()}{n.authorName ? ` · ${n.authorName}` : ''}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#6B7280] text-center py-3">No notes yet.</p>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
