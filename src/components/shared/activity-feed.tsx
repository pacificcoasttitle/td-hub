'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface ActivityEntry {
  id: string | number;
  type: 'document' | 'generated' | 'status' | 'vendor' | 'error' | string;
  summary: string;
  actor?: string | null;
  timestamp: string;
}

interface Props {
  fetchUrl: string;
  emptyMessage?: string;
  accentColor?: string;
}

/* ── Relative time util (exported for reuse) ──────────────────────────────── */

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ── Color map ─────────────────────────────────────────────────────────────── */

const DOT_COLORS: Record<string, string> = {
  document: 'bg-blue-500',
  generated: 'bg-green-500',
  status: 'bg-amber-500',
  vendor: 'bg-purple-500',
  error: 'bg-red-500',
};

/* ── Component ─────────────────────────────────────────────────────────────── */

export function ActivityFeed({ fetchUrl, emptyMessage = 'No activity yet on this file', accentColor = '#F26B2B' }: Props) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const mountRef = useRef(false);

  const doFetch = useCallback(async (cursor?: string) => {
    const isMore = !!cursor;
    if (isMore) setLoadingMore(true); else setLoading(true);
    try {
      const sep = fetchUrl.includes('?') ? '&' : '?';
      const url = cursor ? `${fetchUrl}${sep}before=${encodeURIComponent(cursor)}` : fetchUrl;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const items: ActivityEntry[] = data.entries ?? data.activity ?? [];
      setHasMore(data.hasMore ?? false);
      setEntries((prev) => isMore ? [...prev, ...items] : items);
    } catch { /* noop */ }
    finally { if (isMore) setLoadingMore(false); else setLoading(false); }
  }, [fetchUrl]);

  useEffect(() => {
    if (mountRef.current) return;
    mountRef.current = true;
    doFetch();
  }, [doFetch]);

  function loadMore() {
    if (entries.length === 0 || loadingMore) return;
    const last = entries[entries.length - 1];
    doFetch(last.timestamp);
  }

  if (loading) return <Skeleton />;
  if (entries.length === 0) return <div className="py-10 text-center text-sm text-[#6B7280]">{emptyMessage}</div>;

  return (
    <div className="divide-y divide-gray-100">
      {entries.map((e) => (
        <div key={e.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors">
          <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${DOT_COLORS[e.type] ?? 'bg-gray-400'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#1A1A2E] leading-snug">{e.summary}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {e.actor && <span className="text-xs text-[#6B7280]">{e.actor}</span>}
              <span className="text-xs text-[#9CA3AF]">{timeAgo(e.timestamp)}</span>
            </div>
          </div>
        </div>
      ))}
      {hasMore && (
        <div className="px-4 py-3">
          <button onClick={loadMore} disabled={loadingMore}
            className="text-xs font-medium transition-colors disabled:opacity-50"
            style={{ color: accentColor }}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="divide-y divide-gray-100 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-200 mt-1.5" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-gray-100 rounded" style={{ width: `${55 + Math.random() * 30}%` }} />
            <div className="h-3 bg-gray-100 rounded w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
