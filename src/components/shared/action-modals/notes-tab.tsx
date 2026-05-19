'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Note {
  id: number;
  body: string;
  createdAt: string;
  authorName?: string | null;
  isSyncedToSoftpro?: boolean;
}

export interface NotesTabProps {
  /** Full URL of the notes endpoint, e.g. `/api/orders/123/notes`. Used for both GET and POST. */
  notesUrl: string;
  accentColor?: string;
}

export function NotesTab({ notesUrl, accentColor = '#F26B2B' }: NotesTabProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch(notesUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { notes?: Note[] };
      setNotes(d.notes ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [notesUrl]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadNotes();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadNotes]);

  async function addNote() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(notesUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => null) as { error?: string } | null;
        throw new Error(b?.error ?? `HTTP ${r.status}`);
      }
      setDraft('');
      await loadNotes();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to add note');
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void addNote();
    }
  }

  return (
    <div className="space-y-4">
      {/* List */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {loading ? (
          <NotesSkeleton />
        ) : loadError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-red-800">Failed to load notes. {loadError}</p>
              <button
                type="button"
                onClick={() => void loadNotes()}
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-900"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Retry
              </button>
            </div>
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm text-[#6B7280] text-center py-6">No notes on this file yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="px-3 py-2.5 bg-gray-50 rounded-lg">
              <p className="text-sm text-[#1A1A2E] whitespace-pre-wrap">{n.body}</p>
              <p className="text-[10px] text-[#6B7280] mt-1 flex items-center gap-1.5">
                <span title={new Date(n.createdAt).toLocaleString()}>
                  {new Date(n.createdAt).toLocaleString()}
                </span>
                {n.authorName && <span>· {n.authorName}</span>}
                {n.isSyncedToSoftpro && (
                  <span className="inline-block px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium uppercase tracking-wide">
                    SoftPro
                  </span>
                )}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className="pt-3 border-t border-gray-100">
        <label htmlFor="note-body" className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">
          Add note
        </label>
        <textarea
          id="note-body"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a note…"
          rows={3}
          maxLength={5000}
          disabled={saving}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none outline-none focus:border-[#F26B2B] focus:ring-1 focus:ring-[#F26B2B]/20 disabled:bg-gray-50"
        />
        {saveError && (
          <p className="text-xs text-red-600 mt-1" role="alert">{saveError}</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10px] text-[#9CA3AF]">{draft.length}/5000 · ⌘/Ctrl + Enter to submit</p>
          <button
            type="button"
            onClick={() => void addNote()}
            disabled={!draft.trim() || saving}
            style={{ backgroundColor: accentColor }}
            className="px-4 h-9 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
          >
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotesSkeleton() {
  return (
    <div className="space-y-2 animate-pulse" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="px-3 py-2.5 bg-gray-50 rounded-lg space-y-2">
          <div className="h-3 w-11/12 bg-gray-200 rounded" />
          <div className="h-3 w-2/3 bg-gray-200 rounded" />
          <div className="h-2.5 w-32 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  );
}
