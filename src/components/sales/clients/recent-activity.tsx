'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';

interface RecentNote {
  id: number;
  clientId: number;
  clientName: string;
  body: string;
  createdAt: string;
  authorName: string | null;
}

interface Props {
  /** Manager's selected rep, passed through so the feed matches the list scope. */
  repId: number | null;
  /** Bumped by the parent after a note changes, to refetch. */
  refreshKey: number;
  onOpenClient: (clientId: number) => void;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RecentActivity({ repId, refreshKey, onOpenClient }: Props) {
  const [notes, setNotes] = useState<RecentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchNotes = useCallback(() => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ limit: '10' });
    if (repId !== null) params.set('repId', String(repId));
    fetch(`/api/sales/clients/recent-notes?${params}`)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(d => setNotes(d.notes ?? []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [repId, refreshKey]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  if (error) return null; // the list is the primary content; stay quiet on failure

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <p className="text-sm text-gray-400">
          No notes yet — they&rsquo;ll show up here as you add them.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 -my-1.5">
          {notes.map(note => (
            <li key={note.id}>
              <button
                onClick={() => onOpenClient(note.clientId)}
                className="w-full text-left py-1.5 group flex items-baseline gap-2"
              >
                <span className="text-sm font-medium text-gray-900 group-hover:text-[#F26B2B] transition-colors shrink-0 max-w-[40%] truncate">
                  {note.clientName}
                </span>
                <span className="text-sm text-gray-500 truncate flex-1">{note.body}</span>
                <span className="text-xs text-gray-400 shrink-0">{fmtDate(note.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
